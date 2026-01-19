import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const AutoDetectionAPI = {
  // Get current configuration
  getConfig: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/config`, {
        method: "GET",
        headers: baseHeaders(),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching config:", error);
      return { success: false, error: error.message };
    }
  },

  // Save configuration
  saveConfig: async (config) => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/config`, {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify(config),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error saving config:", error);
      return { success: false, error: error.message };
    }
  },

  // Start detection
  start: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/start`, {
        method: "POST",
        headers: baseHeaders(),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error starting detection:", error);
      return { success: false, error: error.message };
    }
  },

  // Stop detection
  stop: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/stop`, {
        method: "POST",
        headers: baseHeaders(),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error stopping detection:", error);
      return { success: false, error: error.message };
    }
  },

  // Get detection status
  getStatus: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/status`, {
        method: "GET",
        headers: baseHeaders(),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching status:", error);
      return { success: false, error: error.message };
    }
  },

  // Get reports list
  getReports: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/autodetection/reports`, {
        method: "GET",
        headers: baseHeaders(),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching reports:", error);
      return { success: false, error: error.message };
    }
  },

  // Download report
  downloadReport: async (reportId) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/autodetection/report/${reportId}`,
        {
          method: "GET",
          headers: baseHeaders(),
        }
      );

      if (!response.ok) {
        return { success: false, error: "Failed to download report" };
      }

      // Get the filename from the response headers
      const contentDisposition = response.headers.get("content-disposition");
      let filename = `report-${reportId}.csv`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create a blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return { success: true };
    } catch (error) {
      console.error("Error downloading report:", error);
      return { success: false, error: error.message };
    }
  },

  // Delete report
  deleteReport: async (reportId) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/autodetection/report/${reportId}`,
        {
          method: "DELETE",
          headers: baseHeaders(),
        }
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error deleting report:", error);
      return { success: false, error: error.message };
    }
  },

  // Save directory handle to IndexedDB
  saveDirectoryHandle: async (handle, key = "autodetection-directory") => {
    try {
      if (!window.indexedDB) {
        throw new Error("IndexedDB not supported");
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("AnythingLLM", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["directoryHandles"], "readwrite");
          const store = transaction.objectStore("directoryHandles");
          const putRequest = store.put({ key, handle });

          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("directoryHandles")) {
            db.createObjectStore("directoryHandles", { keyPath: "key" });
          }
        };
      });
    } catch (error) {
      console.error("Error saving directory handle:", error);
      return false;
    }
  },

  // Restore directory handle from IndexedDB
  restoreDirectoryHandle: async (key = "autodetection-directory") => {
    try {
      if (!window.indexedDB) {
        throw new Error("IndexedDB not supported");
      }

      return new Promise((resolve, reject) => {
        const request = indexedDB.open("AnythingLLM", 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(["directoryHandles"], "readonly");
          const store = transaction.objectStore("directoryHandles");
          const getRequest = store.get(key);

          getRequest.onerror = () => reject(getRequest.error);
          getRequest.onsuccess = () => resolve(getRequest.result?.handle || null);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("directoryHandles")) {
            db.createObjectStore("directoryHandles", { keyPath: "key" });
          }
        };
      });
    } catch (error) {
      console.error("Error restoring directory handle:", error);
      return null;
    }
  },
};

export default AutoDetectionAPI;
