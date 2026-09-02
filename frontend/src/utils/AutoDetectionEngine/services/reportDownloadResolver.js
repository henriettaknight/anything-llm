/**
 * 纯函数：把报告对象解析为「下载用的分组列表」，决定每个 xlsx 的文件名。
 *
 * 自动下载（检测中）与报告区下载（点已存报告）共用本函数，确保两者产出的
 * xlsx 文件名完全一致（例如都按真实分组名 base / group2 ... 命名，而不是
 * 报告区退化为固定的 all.xlsx）。
 *
 * 解析规则（与历史 downloadReport 行为保持一致）：
 *  - 若 report.groups 存在且非空：逐组使用其 groupName（自动下载路径，已携带完整 groups）。
 *  - 否则退化为单组：组名取传入 groupName / report.groupName / 'root'，
 *    并从 defects / fileResults 重建 batchResults（兼容旧存储报告）。
 *
 * @param {Object} report - 报告对象（自动下载的 detectionReport 或报告区已存报告）
 * @param {string} [groupName] - 兜底组名
 * @returns {Array<{groupName:string, groupPath:string, batchResults:Array}>}
 */
export function resolveReportGroups(report, groupName) {
  const groups = (report.groups && report.groups.length)
    ? report.groups
    : [{
        groupName: groupName || report.groupName || 'root',
        groupPath: report.groupPath || '.',
        batches: report.batches || [],
        fileResults: report.fileResults || [],
        defects: report.defects || []
      }];

  return groups.map((grp) => {
    const gName = grp.groupName || 'root';
    let batchResults = (grp.batches || []).flatMap((batch) => batch.results || []);

    // 兼容已存储报告：优先用扁平 defects（原始结构，含 .file），其次 fileResults
    if (batchResults.length === 0 && grp.defects && grp.defects.length) {
      const byFile = new Map();
      grp.defects.forEach((d) => {
        const fp = d.file || d.filePath || 'unknown';
        if (!byFile.has(fp)) byFile.set(fp, []);
        byFile.get(fp).push(d);
      });
      batchResults = Array.from(byFile.entries()).map(([fp, defs]) => ({
        filePath: fp,
        file: { path: fp },
        defects: defs,
        hasDefects: true
      }));
    } else if (batchResults.length === 0 && grp.fileResults && grp.fileResults.length) {
      batchResults = grp.fileResults.map((fr) => ({
        filePath: fr.filePath || fr.file?.path,
        file: fr.file,
        defects: fr.defects || [],
        hasDefects: (fr.defects?.length || 0) > 0
      }));
    }

    return {
      groupName: gName,
      groupPath: grp.groupPath || '.',
      batchResults
    };
  });
}
