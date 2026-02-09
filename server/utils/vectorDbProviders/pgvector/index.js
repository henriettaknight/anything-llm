const pgsql = require("pg");
const { toChunks, getEmbeddingEngineSelection } = require("../../helpers");
const { TextSplitter } = require("../../TextSplitter");
const { v4: uuidv4 } = require("uuid");
const { sourceIdentifier } = require("../../chats");
const { extractTerms } = require("../../helpers/termExtractor");

/*
 Embedding Table Schema (table name defined by user)
 - id: UUID PRIMARY KEY
 - namespace: TEXT
 - embedding: vector(xxxx)
 - metadata: JSONB
 - created_at: TIMESTAMP
*/

const PGVector = {
  name: "PGVector",
  connectionTimeout: 30_000,
  /**
   * Get the table name for the PGVector database.
   * - Defaults to "anythingllm_vectors" if no table name is provided.
   * @returns {string}
   */
  tableName: () => process.env.PGVECTOR_TABLE_NAME || "anythingllm_vectors",

  /**
   * Get the connection string for the PGVector database.
   * - Requires a connection string to be present in the environment variables.
   * - On the PG docker image - assumes DATABASE_URL to be used here since
   * the user likely wants to store everything in the same database.
   * @returns {string | null}
   */
  connectionString: () =>
    process.env.DATABASE_URL || process.env.PGVECTOR_CONNECTION_STRING,

  // Possible for this to be a user-configurable option in the future.
  // Will require a handler per operator to ensure scores are normalized.
  operator: {
    l2: "<->",
    innerProduct: "<#>",
    cosine: "<=>",
    l1: "<+>",
    hamming: "<~>",
    jaccard: "<%>",
  },
  getTablesSql:
    "SELECT * FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
  getEmbeddingTableSchemaSql:
    "SELECT column_name,data_type FROM information_schema.columns WHERE table_name = $1",
  createExtensionSql: "CREATE EXTENSION IF NOT EXISTS vector;",
  createTableSql: (dimensions) =>
    `CREATE TABLE IF NOT EXISTS "${PGVector.tableName()}" (id UUID PRIMARY KEY, namespace TEXT, embedding vector(${Number(dimensions)}), metadata JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,

  log: function (message = null, ...args) {
    console.log(`\x1b[35m[PGVectorDb]\x1b[0m ${message}`, ...args);
  },
  debugHybridLog: function (message = null, ...args) {
    if (process.env.PGVECTOR_HYBRID_DEBUG !== "true") return;
    console.log(`\x1b[36m[PGVectorHybrid]\x1b[0m ${message}`, ...args);
  },

  /**
   * Recursively sanitize values intended for JSONB to prevent Postgres errors
   * like "unsupported Unicode escape sequence". This primarily removes the
   * NUL character (\u0000) and other disallowed control characters from
   * strings. Arrays and objects are traversed and sanitized deeply.
   * @param {any} value
   * @returns {any}
   */
  sanitizeForJsonb: function (value) {
    // Fast path for null/undefined and primitives that do not need changes
    if (value === null || value === undefined) return value;

    // Strings: strip NUL and unsafe C0 control characters except common whitespace
    if (typeof value === "string") {
      // Build a sanitized string by excluding C0 control characters except
      // horizontal tab (9), line feed (10), and carriage return (13).
      let sanitized = "";
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code === 9 || code === 10 || code === 13 || code >= 0x20) {
          sanitized += value[i];
        }
      }
      return sanitized;
    }

    // Arrays: sanitize each element
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForJsonb(item));
    }

    // Dates: keep as ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Objects: sanitize each property value
    if (typeof value === "object") {
      const result = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.sanitizeForJsonb(v);
      }
      return result;
    }

    // Numbers, booleans, etc.
    return value;
  },

  client: function (connectionString = null) {
    return new pgsql.Client({
      connectionString: connectionString || PGVector.connectionString(),
    });
  },

  /**
   * Validate the existing embedding table schema.
   * @param {pgsql.Client} pgClient
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  validateExistingEmbeddingTableSchema: async function (pgClient, tableName) {
    const result = await pgClient.query(this.getEmbeddingTableSchemaSql, [
      tableName,
    ]);

    // Minimum expected schema for an embedding table.
    // Extra columns are allowed but the minimum exact columns are required
    // to be present in the table.
    const expectedSchema = [
      {
        column_name: "id",
        expected: "uuid",
        validation: function (dataType) {
          return dataType.toLowerCase() === this.expected;
        },
      },
      {
        column_name: "namespace",
        expected: "text",
        validation: function (dataType) {
          return dataType.toLowerCase() === this.expected;
        },
      },
      {
        column_name: "embedding",
        expected: "vector",
        validation: function (dataType) {
          return !!dataType;
        },
      }, // just check if it exists
      {
        column_name: "metadata",
        expected: "jsonb",
        validation: function (dataType) {
          return dataType.toLowerCase() === this.expected;
        },
      },
      {
        column_name: "created_at",
        expected: "timestamp",
        validation: function (dataType) {
          return dataType.toLowerCase().includes(this.expected);
        },
      },
    ];

    if (result.rows.length === 0)
      throw new Error(
        `The table '${tableName}' was found but does not contain any columns or cannot be accessed by role. It cannot be used as an embedding table in AnythingLLM.`
      );

    for (const rowDef of expectedSchema) {
      const column = result.rows.find(
        (c) => c.column_name === rowDef.column_name
      );
      if (!column)
        throw new Error(
          `The column '${rowDef.column_name}' was expected but not found in the table '${tableName}'.`
        );
      if (!rowDef.validation(column.data_type))
        throw new Error(
          `Invalid data type for column: '${column.column_name}'. Got '${column.data_type}' but expected '${rowDef.expected}'`
        );
    }

    this.log(
      `✅ The pgvector table '${tableName}' was found and meets the minimum expected schema for an embedding table.`
    );
    return true;
  },

  /**
   * Validate the connection to the database and verify that the table does not already exist.
   * so that anythingllm can manage the table directly.
   *
   * @param {{connectionString: string | null, tableName: string | null}} params
   * @returns {Promise<{error: string | null, success: boolean}>}
   */
  validateConnection: async function ({
    connectionString = null,
    tableName = null,
  }) {
    if (!connectionString) throw new Error("No connection string provided");

    try {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            error: `Connection timeout (${(PGVector.connectionTimeout / 1000).toFixed(0)}s). Please check your connection string and try again.`,
            success: false,
          });
        }, PGVector.connectionTimeout);
      });

      const connectionPromise = new Promise(async (resolve) => {
        let pgClient = null;
        try {
          pgClient = this.client(connectionString);
          await pgClient.connect();
          const result = await pgClient.query(this.getTablesSql);

          if (result.rows.length !== 0 && !!tableName) {
            const tableExists = result.rows.some(
              (row) => row.tablename === tableName
            );
            if (tableExists)
              await this.validateExistingEmbeddingTableSchema(
                pgClient,
                tableName
              );
          }
          resolve({ error: null, success: true });
        } catch (err) {
          resolve({ error: err.message, success: false });
        } finally {
          if (pgClient) await pgClient.end();
        }
      });

      // Race the connection attempt against the timeout
      const result = await Promise.race([connectionPromise, timeoutPromise]);
      return result;
    } catch (err) {
      this.log("Validation Error:", err.message);
      let readableError = err.message;
      switch (true) {
        case err.message.includes("ECONNREFUSED"):
          readableError =
            "The host could not be reached. Please check your connection string and try again.";
          break;
        default:
          break;
      }
      return { error: readableError, success: false };
    }
  },

  /**
   * Test the connection to the database directly.
   * @returns {{error: string | null, success: boolean}}
   */
  testConnectionToDB: async function () {
    try {
      const pgClient = await this.connect();
      await pgClient.query(this.getTablesSql);
      await pgClient.end();
      return { error: null, success: true };
    } catch (err) {
      return { error: err.message, success: false };
    }
  },

  /**
   * Connect to the database.
   * - Throws an error if the connection string or table name is not provided.
   * @returns {Promise<pgsql.Client>}
   */
  connect: async function () {
    if (!PGVector.connectionString())
      throw new Error("No connection string provided");
    if (!PGVector.tableName()) throw new Error("No table name provided");

    const client = this.client();
    await client.connect();
    return client;
  },

  /**
   * Test the connection to the database with already set credentials via ENV
   * @returns {{error: string | null, success: boolean}}
   */
  heartbeat: async function () {
    return this.testConnectionToDB();
  },

  /**
   * Check if the anythingllm embedding table exists in the database
   * @returns {Promise<boolean>}
   */
  dbTableExists: async function () {
    let connection = null;
    try {
      connection = await this.connect();
      const tables = await connection.query(this.getTablesSql);
      if (tables.rows.length === 0) return false;
      const tableExists = tables.rows.some(
        (row) => row.tablename === PGVector.tableName()
      );
      return !!tableExists;
    } catch (err) {
      return false;
    } finally {
      if (connection) await connection.end();
    }
  },

  totalVectors: async function () {
    if (!(await this.dbTableExists())) return 0;
    let connection = null;
    try {
      connection = await this.connect();
      const result = await connection.query(
        `SELECT COUNT(id) FROM "${PGVector.tableName()}"`
      );
      return result.rows[0].count;
    } catch (err) {
      return 0;
    } finally {
      if (connection) await connection.end();
    }
  },

  // Distance for cosine is just the distance for pgvector.
  distanceToSimilarity: function (distance = null) {
    if (distance === null || typeof distance !== "number") return 0.0;
    if (distance >= 1.0) return 1;
    if (distance < 0) return 1 - Math.abs(distance);
    return 1 - distance;
  },

  namespaceCount: async function (namespace = null) {
    if (!(await this.dbTableExists())) return 0;
    let connection = null;
    try {
      connection = await this.connect();
      const result = await connection.query(
        `SELECT COUNT(id) FROM "${PGVector.tableName()}" WHERE namespace = $1`,
        [namespace]
      );
      return result.rows[0].count;
    } catch (err) {
      return 0;
    } finally {
      if (connection) await connection.end();
    }
  },

  /**
   * Performs a SimilaritySearch on a given PGVector namespace.
   * @param {Object} params
   * @param {pgsql.Client} params.client
   * @param {string} params.namespace
   * @param {number[]} params.queryVector
   * @param {number} params.similarityThreshold
   * @param {number} params.topN
   * @param {string[]} params.filterIdentifiers
   * @returns
   */
  similarityResponse: async function ({
    client,
    namespace,
    queryVector,
    queryText = "",
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
    hybrid = false,
    hybridAlpha = null,
    searchType = "semantic",
  }) {
    const result = {
      contextTexts: [],
      sourceDocuments: [],
      scores: [],
    };

    const embedding = `[${queryVector.map(Number).join(",")}]`;
    const alpha = this.getHybridAlpha(hybridAlpha);
    if (hybrid) {
      this.debugHybridLog("params", {
        namespace,
        topN,
        similarityThreshold,
        alpha,
        queryTextPreview: String(queryText || "").slice(0, 120),
      });
    }
    // Removed hybrid flag console log; use debugHybridLog with explicit flags instead.
    const response = hybrid
      ? await client.query(
          `WITH ranked AS (
            SELECT
              embedding ${this.operator.cosine} $1 AS _distance,
              ts_rank_cd(
                to_tsvector('simple', COALESCE(metadata->>'text', '')),
                plainto_tsquery('simple', COALESCE($2, ''))
              ) AS _keyword_score,
              metadata
            FROM "${PGVector.tableName()}"
            WHERE namespace = $3
          )
          SELECT
            _distance,
            _keyword_score,
            ((1.0 - $4::float) * _keyword_score + $4::float * GREATEST(0, 1 - _distance)) AS _hybrid_score,
            metadata
          FROM ranked
          ORDER BY _hybrid_score DESC
          LIMIT $5`,
          [embedding, queryText, namespace, alpha, topN]
        )
      : await client.query(
          `SELECT embedding ${this.operator.cosine} $1 AS _distance, metadata FROM "${PGVector.tableName()}" WHERE namespace = $2 ORDER BY _distance ASC LIMIT $3`,
          [embedding, namespace, topN]
        );
    response.rows.forEach((item, idx) => {
      const vectorScore = this.distanceToSimilarity(item._distance);
      const keywordScore = Number(item._keyword_score ?? 0);
      const hybridScore = Number(item._hybrid_score ?? 0);
      const score = hybrid ? hybridScore : vectorScore;
      const passThreshold = hybrid
        ? Math.max(vectorScore, keywordScore) >= similarityThreshold
        : vectorScore >= similarityThreshold;
      if (hybrid) {
        this.debugHybridLog("score", {
          index: idx,
          vectorDistance: item._distance,
          vectorScore,
          keywordScore,
          alpha,
          hybridScore,
          blended: `(1 - ${alpha})*${keywordScore} + ${alpha}*${Math.max(
            0,
            1 - item._distance
          )}`,
          passThreshold,
          sourceId: sourceIdentifier(item.metadata),
        });
      }
      if (!passThreshold) return;
      if (filterIdentifiers.includes(sourceIdentifier(item.metadata))) {
        this.log(
          "A source was filtered from context as it's parent document is pinned."
        );
        return;
      }

      result.contextTexts.push(item.metadata.text);
      result.sourceDocuments.push({
        ...item.metadata,
        score,
        ...(hybrid
          ? {
              vectorScore,
              keywordScore,
              hybridAlpha: alpha,
            }
          : {}),
        searchType,
      });
      result.scores.push(score);
    });

    return result;
  },
  keywordResponse: async function ({
    client,
    namespace,
    queryText = "",
    similarityThreshold = 0.0,
    topN = 4,
    filterIdentifiers = [],
    searchType = "keyword",
  }) {
    const result = {
      contextTexts: [],
      sourceDocuments: [],
      scores: [],
    };
    if (!queryText) return result;

    this.debugHybridLog("keyword:query", { queryText, namespace, topN });
    const response = await client.query(
      `WITH ranked AS (
        SELECT
          ts_rank_cd(
            to_tsvector('simple', COALESCE(metadata->>'text', '')),
            plainto_tsquery('simple', COALESCE($1, ''))
          ) AS _keyword_score,
          metadata
        FROM "${PGVector.tableName()}"
        WHERE namespace = $2
      )
      SELECT _keyword_score, metadata
      FROM ranked
      WHERE _keyword_score > 0
      ORDER BY _keyword_score DESC
      LIMIT $3`,
      [queryText, namespace, topN]
    );

    response.rows.forEach((item) => {
      const keywordScore = Number(item._keyword_score ?? 0);
      if (keywordScore <= 0) return;
      if (keywordScore < similarityThreshold) return;
      if (filterIdentifiers.includes(sourceIdentifier(item.metadata))) {
        this.log(
          "A source was filtered from context as it's parent document is pinned."
        );
        return;
      }
      result.contextTexts.push(item.metadata.text);
      result.sourceDocuments.push({
        ...item.metadata,
        score: keywordScore,
        keywordScore,
        searchType,
      });
      result.scores.push(keywordScore);
    });

    this.debugHybridLog("keyword:results", {
      queryText,
      count: result.sourceDocuments.length,
      topScores: result.sourceDocuments
        .slice(0, 3)
        .map((doc) => doc.keywordScore || doc.score),
    });

    return result;
  },

  normalizeVector: function (vector) {
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude === 0) return vector; // Avoid division by zero
    return vector.map((val) => val / magnitude);
  },

  getHybridAlpha: function (alpha = null) {
    const fallback = 0.5;
    const raw =
      alpha ??
      process.env.PGVECTOR_HYBRID_ALPHA ??
      process.env.VECTOR_HYBRID_ALPHA;
    if (raw === null || raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return fallback;
    if (parsed < 0) return 0;
    if (parsed > 1) return 1;
    return parsed;
  },

  /**
   * Update or create a collection in the database
   * @param {Object} params
   * @param {pgsql.Connection} params.connection
   * @param {{id: number, vector: number[], metadata: Object}[]} params.submissions
   * @param {string} params.namespace
   * @param {number} params.dimensions
   * @returns {Promise<boolean>}
   */
  updateOrCreateCollection: async function ({
    connection,
    submissions,
    namespace,
    dimensions = 384,
  }) {
    await this.createTableIfNotExists(connection, dimensions);
    this.log(`Updating or creating collection ${namespace}`);

    try {
      // Create a transaction of all inserts
      await connection.query(`BEGIN`);
      for (const submission of submissions) {
        const embedding = `[${submission.vector.map(Number).join(",")}]`; // stringify the vector for pgvector
        const sanitizedMetadata = this.sanitizeForJsonb(submission.metadata);
        await connection.query(
          `INSERT INTO "${PGVector.tableName()}" (id, namespace, embedding, metadata) VALUES ($1, $2, $3, $4)`,
          [submission.id, namespace, embedding, sanitizedMetadata]
        );
      }
      this.log(`Committing ${submissions.length} vectors to ${namespace}`);
      await connection.query(`COMMIT`);
    } catch (err) {
      this.log(
        `Rolling back ${submissions.length} vectors to ${namespace}`,
        err
      );
      await connection.query(`ROLLBACK`);
    }
    return true;
  },

  /**
   * create a table if it doesn't exist
   * @param {pgsql.Client} connection
   * @param {number} dimensions
   * @returns
   */
  createTableIfNotExists: async function (connection, dimensions = 384) {
    this.log(`Creating embedding table with ${dimensions} dimensions`);
    await connection.query(this.createExtensionSql);
    await connection.query(this.createTableSql(dimensions));
    return true;
  },

  /**
   * Get the namespace from the database
   * @param {pgsql.Client} connection
   * @param {string} namespace
   * @returns {Promise<{name: string, vectorCount: number}>}
   */
  namespace: async function (connection, namespace = null) {
    if (!namespace) throw new Error("No namespace provided");
    const result = await connection.query(
      `SELECT COUNT(id) FROM "${PGVector.tableName()}" WHERE namespace = $1`,
      [namespace]
    );
    return { name: namespace, vectorCount: result.rows[0].count };
  },

  /**
   * Check if the namespace exists in the database
   * @param {string} namespace
   * @returns {Promise<boolean>}
   */
  hasNamespace: async function (namespace = null) {
    if (!namespace) throw new Error("No namespace provided");
    let connection = null;
    try {
      connection = await this.connect();
      return await this.namespaceExists(connection, namespace);
    } catch (err) {
      return false;
    } finally {
      if (connection) await connection.end();
    }
  },

  /**
   * Check if the namespace exists in the database
   * @param {pgsql.Client} connection
   * @param {string} namespace
   * @returns {Promise<boolean>}
   */
  namespaceExists: async function (connection, namespace = null) {
    if (!namespace) throw new Error("No namespace provided");
    const result = await connection.query(
      `SELECT COUNT(id) FROM "${PGVector.tableName()}" WHERE namespace = $1 LIMIT 1`,
      [namespace]
    );
    return result.rows[0].count > 0;
  },

  /**
   * Delete all vectors in the namespace
   * @param {pgsql.Client} connection
   * @param {string} namespace
   * @returns {Promise<boolean>}
   */
  deleteVectorsInNamespace: async function (connection, namespace = null) {
    if (!namespace) throw new Error("No namespace provided");
    await connection.query(
      `DELETE FROM "${PGVector.tableName()}" WHERE namespace = $1`,
      [namespace]
    );
    return true;
  },

  addDocumentToNamespace: async function (
    namespace,
    documentData = {},
    fullFilePath = null,
    skipCache = false
  ) {
    const { DocumentVectors } = require("../../../models/vectors");
    const {
      storeVectorResult,
      cachedVectorInformation,
    } = require("../../files");
    let connection = null;

    try {
      const { pageContent, docId, ...metadata } = documentData;
      if (!pageContent || pageContent.length == 0) return false;
      connection = await this.connect();

      this.log("Adding new vectorized document into namespace", namespace);
      if (!skipCache) {
        const cacheResult = await cachedVectorInformation(fullFilePath);
        let vectorDimensions;
        if (cacheResult.exists) {
          const { chunks } = cacheResult;
          const documentVectors = [];
          const submissions = [];

          for (const chunk of chunks.flat()) {
            if (!vectorDimensions) vectorDimensions = chunk.values.length;
            const id = uuidv4();
            const { id: _id, ...metadata } = chunk.metadata;
            documentVectors.push({ docId, vectorId: id });
            submissions.push({ id: id, vector: chunk.values, metadata });
          }

          await this.updateOrCreateCollection({
            connection,
            submissions,
            namespace,
            dimensions: vectorDimensions,
          });
          await DocumentVectors.bulkInsert(documentVectors);
          return { vectorized: true, error: null };
        }
      }

      // If we are here then we are going to embed and store a novel document.
      // We have to do this manually as opposed to using LangChains `xyz.fromDocuments`
      // because we then cannot atomically control our namespace to granularly find/remove documents
      // from vectordb.
      const { SystemSettings } = require("../../../models/systemSettings");
      const EmbedderEngine = getEmbeddingEngineSelection();
      const textSplitter = new TextSplitter({
        chunkSize: TextSplitter.determineMaxChunkSize(
          await SystemSettings.getValueOrFallback({
            label: "text_splitter_chunk_size",
          }),
          EmbedderEngine?.embeddingMaxChunkLength
        ),
        chunkOverlap: await SystemSettings.getValueOrFallback(
          { label: "text_splitter_chunk_overlap" },
          20
        ),
        chunkHeaderMeta: TextSplitter.buildHeaderMeta(metadata),
        chunkPrefix: EmbedderEngine?.embeddingPrefix,
      });
      const textChunks = await textSplitter.splitText(pageContent);

      this.log("Snippets created from document:", textChunks.length);
      const documentVectors = [];
      const vectors = [];
      const submissions = [];
      const vectorValues = await EmbedderEngine.embedChunks(textChunks);
      let vectorDimensions;

      if (!!vectorValues && vectorValues.length > 0) {
        for (const [i, vector] of vectorValues.entries()) {
          if (!vectorDimensions) vectorDimensions = vector.length;
          const vectorRecord = {
            id: uuidv4(),
            values: vector,
            metadata: { ...metadata, text: textChunks[i] },
          };

          vectors.push(vectorRecord);
          submissions.push({
            id: vectorRecord.id,
            vector: vectorRecord.values,
            metadata: vectorRecord.metadata,
          });
          documentVectors.push({ docId, vectorId: vectorRecord.id });
        }
      } else {
        throw new Error(
          "Could not embed document chunks! This document will not be recorded."
        );
      }

      if (vectors.length > 0) {
        const chunks = [];
        for (const chunk of toChunks(vectors, 500)) chunks.push(chunk);

        this.log("Inserting vectorized chunks into PGVector collection.");
        await this.updateOrCreateCollection({
          connection,
          submissions,
          namespace,
          dimensions: vectorDimensions,
        });
        await storeVectorResult(chunks, fullFilePath);
      }

      await DocumentVectors.bulkInsert(documentVectors);
      return { vectorized: true, error: null };
    } catch (err) {
      this.log("addDocumentToNamespace", err.message);
      return { vectorized: false, error: err.message };
    } finally {
      if (connection) await connection.end();
    }
  },

  /**
   * Delete a document from the namespace
   * @param {string} namespace
   * @param {string} docId
   * @returns {Promise<boolean>}
   */
  deleteDocumentFromNamespace: async function (namespace, docId) {
    if (!namespace) throw new Error("No namespace provided");
    if (!docId) throw new Error("No docId provided");

    let connection = null;
    try {
      connection = await this.connect();
      const exists = await this.namespaceExists(connection, namespace);
      if (!exists)
        throw new Error(
          `PGVector:deleteDocumentFromNamespace - namespace ${namespace} does not exist.`
        );

      const { DocumentVectors } = require("../../../models/vectors");
      const vectorIds = (await DocumentVectors.where({ docId })).map(
        (record) => record.vectorId
      );
      if (vectorIds.length === 0) return;

      try {
        await connection.query(`BEGIN`);
        for (const vectorId of vectorIds)
          await connection.query(
            `DELETE FROM "${PGVector.tableName()}" WHERE id = $1`,
            [vectorId]
          );
        await connection.query(`COMMIT`);
      } catch (err) {
        await connection.query(`ROLLBACK`);
        throw err;
      }

      this.log(
        `Deleted ${vectorIds.length} vectors from namespace ${namespace}`
      );
      return true;
    } catch (err) {
      this.log(
        `Error deleting document from namespace ${namespace}: ${err.message}`
      );
      return false;
    } finally {
      if (connection) await connection.end();
    }
  },

  performSimilaritySearch: async function ({
    namespace = null,
    input = "",
    LLMConnector = null,
    similarityThreshold = 0.25,
    topN = 4,
    filterIdentifiers = [],
    hybrid = false,
    hybridAlpha = null,
  }) {
    let connection = null;
    if (!namespace || !input || !LLMConnector)
      throw new Error("Invalid request to performSimilaritySearch.");

    try {
      connection = await this.connect();
      const exists = await this.namespaceExists(connection, namespace);
      if (!exists) {
        this.log(
          `The namespace ${namespace} does not exist or has no vectors. Returning empty results.`
        );
        return {
          contextTexts: [],
          sources: [],
          message: null,
        };
      }

      this.debugHybridLog("semanticSearch", true);
      const queryVector = await LLMConnector.embedTextInput(input);
      const alpha = this.getHybridAlpha(hybridAlpha);
      const semanticResult = await this.similarityResponse({
        client: connection,
        namespace,
        queryVector,
        queryText: "",
        similarityThreshold,
        topN,
        filterIdentifiers,
        hybrid: false,
        hybridAlpha,
        searchType: "semantic",
      });

      let { contextTexts, sourceDocuments } = semanticResult;

      let terms = [];
      if (hybrid) {
        this.debugHybridLog("keywordSearch", true);
        terms = extractTerms(input);
        if (terms.length > 0) this.debugHybridLog("terms", terms);

        const keywordDocs = [];
        const keywordTexts = [];
        const perTermLimit = Number(process.env.KEYWORD_TOPK_PER_TERM || 1);
        for (const term of terms) {
          const termResult = await this.keywordResponse({
            client: connection,
            namespace,
            queryText: term,
            similarityThreshold,
            topN: perTermLimit,
            filterIdentifiers,
            searchType: "keyword",
          });

          termResult.sourceDocuments.forEach((doc, idx) => {
            keywordDocs.push({
              ...doc,
              matchedTerms: [term],
            });
            keywordTexts.push(termResult.contextTexts[idx]);
          });
        }

        const combinedKeyword = [];
        const combinedKeywordTexts = [];
        const keywordSeen = new Set();

        keywordDocs
          .map((doc, idx) => ({ doc, text: keywordTexts[idx] }))
          .sort((a, b) => (b.doc.keywordScore || 0) - (a.doc.keywordScore || 0))
          .forEach(({ doc, text }) => {
            if (combinedKeyword.length >= topN) return;
            const baseKey = doc?.id ? doc.id : sourceIdentifier(doc);
            const termKey =
              Array.isArray(doc?.matchedTerms) && doc.matchedTerms.length
                ? doc.matchedTerms.join("|")
                : "";
            const key = termKey ? `${baseKey}::${termKey}` : baseKey;
            if (keywordSeen.has(key)) return;
            keywordSeen.add(key);
            combinedKeyword.push(doc);
            combinedKeywordTexts.push(text);
          });

        const fused = this.rrfFuseResults({
          semanticDocs: sourceDocuments,
          semanticTexts: contextTexts,
          keywordDocs: combinedKeyword,
          keywordTexts: combinedKeywordTexts,
          weightSemantic: alpha,
          weightKeyword: 1 - alpha,
        });
        sourceDocuments = fused.sourceDocuments;
        contextTexts = fused.contextTexts;
      }

      if (terms.length > 0) {
        sourceDocuments = sourceDocuments.map((doc, idx) => {
          const text = contextTexts[idx] || "";
          const matchedTerms = terms.filter((term) => {
            if (!term) return false;
            if (/[A-Za-z]/.test(term)) {
              return text.toLowerCase().includes(term.toLowerCase());
            }
            return text.includes(term);
          });
          return {
            ...doc,
            matchedTerms,
            queryTerms: terms,
          };
        });
      }

      const sources = sourceDocuments.map((metadata, i) => {
        return { metadata: { ...metadata, text: contextTexts[i] } };
      });
      return {
        contextTexts,
        sources: this.curateSources(sources),
        message: false,
      };
    } catch (err) {
      console.error("[PGVector] similarity search error:", err);
      return {
        contextTexts: [],
        sources: [],
        message: err.message || "PGVector similarity search failed.",
      };
    } finally {
      if (connection) await connection.end();
    }
  },
  rrfFuseResults: function ({
    semanticDocs = [],
    semanticTexts = [],
    keywordDocs = [],
    keywordTexts = [],
    weightSemantic = null,
    weightKeyword = null,
  }) {
    const k = Number(process.env.RRF_K || 60);
    const wSemantic =
      weightSemantic !== null && weightSemantic !== undefined
        ? Number(weightSemantic)
        : Number(process.env.RRF_WEIGHT_SEMANTIC || 1);
    const wKeyword =
      weightKeyword !== null && weightKeyword !== undefined
        ? Number(weightKeyword)
        : Number(process.env.RRF_WEIGHT_KEYWORD || 1);

    const items = new Map();
    const addList = (docs, texts, weight, type) => {
      docs.forEach((doc, idx) => {
        const baseKey = doc?.id ? doc.id : sourceIdentifier(doc);
        const termKey =
          type === "keyword" &&
          Array.isArray(doc?.matchedTerms) &&
          doc.matchedTerms.length
            ? doc.matchedTerms.join("|")
            : "";
        const key =
          type === "semantic"
            ? `${baseKey}::${idx}`
            : termKey
              ? `${baseKey}::${termKey}`
              : baseKey;
        const rank = idx + 1;
        const score = weight / (k + rank);
        const existing = items.get(key);
        if (!existing) {
          items.set(key, {
            doc: { ...doc },
            text: texts[idx],
            rrfScore: score,
            hasKeyword: type === "keyword",
            hasSemantic: type === "semantic",
          });
        } else {
          existing.rrfScore += score;
          if (type === "keyword") {
            existing.hasKeyword = true;
            // Prefer keyword text when available
            existing.text = texts[idx] || existing.text;
            existing.doc = { ...existing.doc, ...doc };
          } else {
            existing.hasSemantic = true;
          }
        }
      });
    };

    addList(semanticDocs, semanticTexts, wSemantic, "semantic");
    addList(keywordDocs, keywordTexts, wKeyword, "keyword");

    const fused = Array.from(items.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map((item) => {
        const searchType = item.hasKeyword ? "keyword" : "semantic";
        return {
          doc: { ...item.doc, searchType, rrfScore: item.rrfScore },
          text: item.text,
        };
      });

    return {
      sourceDocuments: fused.map((item) => item.doc),
      contextTexts: fused.map((item) => item.text),
    };
  },

  "namespace-stats": async function (reqBody = {}) {
    const { namespace = null } = reqBody;
    if (!namespace) throw new Error("namespace required");
    if (!(await this.dbTableExists()))
      return { message: "No table found in database" };

    let connection = null;
    try {
      connection = await this.connect();
      if (!(await this.namespaceExists(connection, namespace)))
        throw new Error("Namespace by that name does not exist.");
      const stats = await this.namespace(connection, namespace);
      return stats
        ? stats
        : { message: "No stats were able to be fetched from DB for namespace" };
    } catch (err) {
      return {
        message: `Error fetching stats for namespace ${namespace}: ${err.message}`,
      };
    } finally {
      if (connection) await connection.end();
    }
  },

  "delete-namespace": async function (reqBody = {}) {
    const { namespace = null } = reqBody;
    if (!namespace) throw new Error("No namespace provided");

    let connection = null;
    try {
      const existingCount = await this.namespaceCount(namespace);
      if (existingCount === 0)
        return {
          message: `Namespace ${namespace} does not exist or has no vectors.`,
        };

      connection = await this.connect();
      await this.deleteVectorsInNamespace(connection, namespace);
      return {
        message: `Namespace ${namespace} was deleted along with ${existingCount} vectors.`,
      };
    } catch (err) {
      return {
        message: `Error deleting namespace ${namespace}: ${err.message}`,
      };
    } finally {
      if (connection) await connection.end();
    }
  },

  /**
   * Reset the entire vector database table associated with anythingllm
   * @returns {Promise<{reset: boolean}>}
   */
  reset: async function () {
    let connection = null;
    try {
      connection = await this.connect();
      await connection.query(`DROP TABLE IF EXISTS "${PGVector.tableName()}"`);
      return { reset: true };
    } catch (err) {
      return { reset: false };
    } finally {
      if (connection) await connection.end();
    }
  },

  curateSources: function (sources = []) {
    const documents = [];
    for (const source of sources) {
      const { text, vector: _v, _distance: _d, ...rest } = source;
      const metadata = rest.hasOwnProperty("metadata") ? rest.metadata : rest;
      if (Object.keys(metadata).length > 0) {
        documents.push({
          ...metadata,
          ...(text ? { text } : {}),
        });
      }
    }

    return documents;
  },
};

module.exports.PGVector = PGVector;
