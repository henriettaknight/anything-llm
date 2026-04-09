/**
 * Verify generated HTML report
 */

const ReportGenerator = require('./ReportGenerator');
const DataCollector = require('./DataCollector');
const fs = require('fs').promises;

async function verifyReport() {
  const reportGenerator = new ReportGenerator();
  const dataCollector = new DataCollector();

  // Create test session
  const session = await dataCollector.startSession();
  
  // Add module
  const module1 = await dataCollector.startModule(session.sessionId, 'Test Module');
  
  await dataCollector.recordFile(session.sessionId, module1.moduleId, {
    filePath: '/test/file.js',
    fileName: 'file.js',
    fileType: 'javascript',
    operationType: 'analyze',
    inputTokens: 1000,
    outputTokens: 500,
    totalLines: 100,
    codeLines: 70,
    commentLines: 15,
  });

  await dataCollector.endModule(session.sessionId, module1.moduleId);
  await dataCollector.endSession(session.sessionId);

  // Generate report
  const reportPath = await reportGenerator.generateHTMLReport(session.sessionId, 'en-US');
  
  // Read and display report
  const content = await fs.readFile(reportPath, 'utf-8');
  console.log('=== Generated HTML Report ===\n');
  console.log(content);
}

verifyReport().catch(console.error);
