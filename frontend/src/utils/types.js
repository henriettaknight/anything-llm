export function castToType(key, value) {
  const definitions = {
    openAiTemp: {
      cast: (value) => Number(value),
    },
    openAiHistory: {
      cast: (value) => Number(value),
    },
    similarityThreshold: {
      cast: (value) => parseFloat(value),
    },
    topN: {
      cast: (value) => Number(value),
    },
    vectorSearchHybridAlpha: {
      cast: (value) => parseFloat(value),
    },
    vectorSearchHybridEnabled: {
      cast: (value) => value === "enabled" || value === true,
    },
  };

  if (!definitions.hasOwnProperty(key)) return value;
  return definitions[key].cast(value);
}
