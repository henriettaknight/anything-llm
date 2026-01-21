/**
 * @fileoverview File Monitor Service
 * Handles file scanning, filtering, and monitoring operations
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} path - File path
 * @property {string} name - File name
 * @property {number} lastModified - Last modified timestamp
 * @property {number} size - File size in bytes
 * @property {boolean} isDirectory - Whether it's a directory
 */

/**
 * @typedef {Object} FileGroup
 * @property {string} name - Group name (directory name)
 * @property {string} path - Group path
 * @property {FileInfo[]} files - List of files
 */

/**
 * @typedef {Object} ScanResult
 * @property {FileGroup[]} groups - First-level subdirectory groups
 * @property {FileInfo[]} rootFiles - Root directory scattered files
 */

// C++ file extension list
const CPLUSPLUS_EXTENSIONS = ['.h', '.cpp', '.hpp', '.cc', '.cxx', '.c++', '.h++'];

/**
 * Check if file is a C++ file
 * @param {string} fileName - File name
 * @returns {boolean} - True if it's a C++ file
 */
export const isCppFile = (fileName) => {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  return CPLUSPLUS_EXTENSIONS.includes(extension);
};

/**
 * Get file info from entry (for browser file system API)
 * @param {FileSystemEntry} entry - File system entry
 * @returns {Promise<FileInfo>} - File information
 */
export const getFileInfoFromEntry = async (entry) => {
  const isDirectory = entry.isDirectory;
  const lastModified = Date.now();
  const size = 0;

  if (isDirectory) {
    return {
      path: entry.fullPath,
      name: entry.name,
      lastModified,
      size,
      isDirectory
    };
  } else {
    // Get file details
    const fileEntry = entry;
    return new Promise((resolve, reject) => {
      fileEntry.file(
        (file) => {
          resolve({
            path: entry.fullPath,
            name: entry.name,
            lastModified: file.lastModified,
            size: file.size,
            isDirectory: false
          });
        },
        reject
      );
    });
  }
};

/**
 * Recursively scan directory
 * @param {FileSystemDirectoryEntry} directoryEntry - Directory entry
 * @returns {Promise<FileInfo[]>} - List of files
 */
export const scanDirectory = async (directoryEntry) => {
  const result = [];

  return new Promise((resolve, reject) => {
    const reader = directoryEntry.createReader();
    const readEntries = () => {
      reader.readEntries(
        async (entries) => {
          if (entries.length === 0) {
            // No more entries
            resolve(result);
          } else {
            // Process current batch of entries
            for (const entry of entries) {
              if (entry.isDirectory) {
                // Recursively scan subdirectory
                const subDirResult = await scanDirectory(entry);
                result.push(...subDirResult);
              } else if (isCppFile(entry.name)) {
                // Only process C++ files
                const fileInfo = await getFileInfoFromEntry(entry);
                result.push(fileInfo);
              }
            }
            // Continue reading next batch of entries
            readEntries();
          }
        },
        reject
      );
    };

    readEntries();
  });
};

/**
 * Compare file lists to find new or modified files
 * @param {FileInfo[]} previousFiles - Previous file list
 * @param {FileInfo[]} currentFiles - Current file list
 * @returns {FileInfo[]} - Changed files
 */
export const findChangedFiles = (previousFiles, currentFiles) => {
  const changedFiles = [];
  const previousFileMap = new Map(previousFiles.map(file => [file.path, file]));

  // Check for new or modified files
  for (const currentFile of currentFiles) {
    const previousFile = previousFileMap.get(currentFile.path);
    if (!previousFile || previousFile.lastModified !== currentFile.lastModified) {
      changedFiles.push(currentFile);
    }
  }

  return changedFiles;
};

/**
 * Scan directory from handle (for modern browser file system access API)
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @param {string} [path=''] - Current path
 * @returns {Promise<FileInfo[]>} - List of files
 */
export const scanDirectoryFromHandle = async (directoryHandle, path = '') => {
  const result = [];

  try {
    // Use compatible method: manually iterate directory contents
    const entries = [];
    
    // Use compatible iteration method
    if ('entries' in directoryHandle && typeof directoryHandle.entries === 'function') {
      const iterator = directoryHandle.entries();
      let entry = await iterator.next();
      while (!entry.done) {
        entries.push(entry.value);
        entry = await iterator.next();
      }
    }
    
    for (const [name, handle] of entries) {
      const currentPath = path ? `${path}/${name}` : name;
      
      if (handle.kind === 'directory') {
        // Recursively scan subdirectory
        const subDirResult = await scanDirectoryFromHandle(handle, currentPath);
        result.push(...subDirResult);
      } else if (isCppFile(name)) {
        // Only process C++ files
        const file = await handle.getFile();
        result.push({
          path: currentPath,
          name,
          lastModified: file.lastModified,
          size: file.size,
          isDirectory: false
        });
      }
    }
  } catch (error) {
    console.error('扫描目录时发生错误:', error);
  }

  return result;
};

/**
 * Get file content from file list
 * @param {FileInfo} fileInfo - File information
 * @param {FileSystemDirectoryHandle} [directoryHandle] - Directory handle
 * @returns {Promise<string>} - File content
 */
export const getFileContent = async (fileInfo, directoryHandle) => {
  if (!directoryHandle) {
    throw new Error('Directory handle is required but was not provided');
  }
  
  // Get file handle based on file path
  const pathParts = fileInfo.path.split('/').filter(Boolean);
  let currentHandle = directoryHandle;
  
  for (let i = 0; i < pathParts.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
  }
  
  const fileHandle = await currentHandle.getFileHandle(pathParts[pathParts.length - 1]);
  const file = await fileHandle.getFile();
  return await file.text();
};

/**
 * Check if path matches exclude patterns
 * @param {string} path - File path
 * @param {string[]} excludePatterns - Exclude patterns (glob-like)
 * @returns {boolean} - True if path should be excluded
 */
export const shouldExclude = (path, excludePatterns = []) => {
  if (!excludePatterns || excludePatterns.length === 0) {
    return false;
  }
  
  for (const pattern of excludePatterns) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    if (regex.test(path)) {
      return true;
    }
  }
  
  return false;
};

/**
 * Filter files based on configuration
 * @param {FileInfo[]} files - Files to filter
 * @param {Object} config - Filter configuration
 * @param {string[]} [config.fileTypes] - Allowed file extensions (e.g., ['.h', '.cpp'])
 * @param {string[]} [config.excludePatterns] - Exclude patterns
 * @returns {FileInfo[]} - Filtered files
 */
export const filterFiles = (files, config = {}) => {
  const { fileTypes, excludePatterns } = config;
  
  return files.filter(file => {
    // Check exclude patterns
    if (shouldExclude(file.path, excludePatterns)) {
      return false;
    }
    
    // Check file types if specified
    if (fileTypes && fileTypes.length > 0) {
      const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return fileTypes.includes(extension);
    }
    
    // Default: include all C++ files
    return isCppFile(file.name);
  });
};

/**
 * Scan directory with configuration-based filtering
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @param {string} [path=''] - Current path
 * @param {Object} [config] - Filter configuration
 * @returns {Promise<FileInfo[]>} - List of filtered files
 */
export const scanDirectoryWithFilter = async (directoryHandle, path = '', config = {}) => {
  const result = [];

  try {
    const entries = [];
    
    if ('entries' in directoryHandle && typeof directoryHandle.entries === 'function') {
      const iterator = directoryHandle.entries();
      let entry = await iterator.next();
      while (!entry.done) {
        entries.push(entry.value);
        entry = await iterator.next();
      }
    }
    
    for (const [name, handle] of entries) {
      const currentPath = path ? `${path}/${name}` : name;
      
      // Check if directory should be excluded
      if (handle.kind === 'directory') {
        if (shouldExclude(currentPath, config.excludePatterns)) {
          continue;
        }
        
        // Recursively scan subdirectory
        const subDirResult = await scanDirectoryWithFilter(handle, currentPath, config);
        result.push(...subDirResult);
      } else {
        // Check if file should be included
        const fileInfo = {
          path: currentPath,
          name,
          lastModified: 0,
          size: 0,
          isDirectory: false
        };
        
        // Apply file type and exclude pattern filters
        if (!shouldExclude(currentPath, config.excludePatterns)) {
          if (config.fileTypes && config.fileTypes.length > 0) {
            const extension = name.toLowerCase().substring(name.lastIndexOf('.'));
            if (config.fileTypes.includes(extension)) {
              const file = await handle.getFile();
              fileInfo.lastModified = file.lastModified;
              fileInfo.size = file.size;
              result.push(fileInfo);
            }
          } else if (isCppFile(name)) {
            const file = await handle.getFile();
            fileInfo.lastModified = file.lastModified;
            fileInfo.size = file.size;
            result.push(fileInfo);
          }
        }
      }
    }
  } catch (error) {
    console.error('扫描目录时发生错误:', error);
  }

  return result;
};

/**
 * Scan directory by first-level subdirectory groups
 * @param {FileSystemDirectoryHandle} directoryHandle - Directory handle
 * @param {Object} [config] - Filter configuration
 * @returns {Promise<ScanResult>} - Scan result with groups and root files
 */
export const scanDirectoryByGroups = async (directoryHandle, config = {}) => {
  const groups = [];
  const rootFiles = [];

  try {
    // Use compatible method: manually iterate directory contents
    const entries = [];
    
    // Use compatible iteration method
    if ('entries' in directoryHandle && typeof directoryHandle.entries === 'function') {
      const iterator = directoryHandle.entries();
      let entry = await iterator.next();
      while (!entry.done) {
        entries.push(entry.value);
        entry = await iterator.next();
      }
    }
    
    // Iterate root directory
    for (const [name, handle] of entries) {
      if (handle.kind === 'directory') {
        // Check if directory should be excluded
        if (shouldExclude(name, config.excludePatterns)) {
          console.log(`跳过排除的目录: ${name}`);
          continue;
        }
        
        // First-level subdirectory: recursively scan with filter
        console.log(`扫描第一级子目录: ${name}`);
        const files = await scanDirectoryWithFilter(handle, name, config);
        
        if (files.length > 0) {
          groups.push({
            name: name,
            path: name,
            files: files
          });
          console.log(`子目录 ${name} 扫描完成，发现 ${files.length} 个文件`);
        } else {
          console.log(`子目录 ${name} 没有符合条件的文件，跳过`);
        }
      } else if (handle.kind === 'file') {
        // Root directory file: check if it should be included
        if (!shouldExclude(name, config.excludePatterns)) {
          if (config.fileTypes && config.fileTypes.length > 0) {
            const extension = name.toLowerCase().substring(name.lastIndexOf('.'));
            if (config.fileTypes.includes(extension)) {
              const file = await handle.getFile();
              rootFiles.push({
                path: name,
                name: name,
                lastModified: file.lastModified,
                size: file.size,
                isDirectory: false
              });
            }
          } else if (isCppFile(name)) {
            const file = await handle.getFile();
            rootFiles.push({
              path: name,
              name: name,
              lastModified: file.lastModified,
              size: file.size,
              isDirectory: false
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('按分组扫描目录时发生错误:', error);
  }

  console.log(`分组扫描完成，发现 ${groups.length} 个分组，根目录文件 ${rootFiles.length} 个`);
  return { groups, rootFiles };
};
