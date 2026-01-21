/**
 * Auto Detection Services
 * Centralized export for all auto detection frontend services
 */

// Core services
export { default as configService } from './configService.js';
export { default as detectionService } from './detectionService.js';
export { default as reportService } from './reportService.js';

// Task scheduling and automation services
export { default as schedulerService, ScheduleType, SchedulerStatus } from './schedulerService.js';
export { default as fileWatcherService, WatcherStatus, Sensitivity } from './fileWatcherService.js';
export { default as taskQueueService, TaskStatus, TaskPriority, NotificationType } from './taskQueueService.js';
