import * as dashboardService from '../services/dashboardService';

export async function stats() {
  return dashboardService.getDashboardStats();
}
