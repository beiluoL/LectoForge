import * as overviewService from '../services/overviewService';

export async function overview() {
  return overviewService.getOverview();
}
