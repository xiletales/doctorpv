export type WorkOrderStatus = "new" | "in_progress" | "done";

export interface WorkOrderDto {
  id: string;
  assetType: string;
  assetId: string;
  zoneId: string;
  source: string;
  priority: string;
  status: WorkOrderStatus;
  title: string;
  assignee: string | null;
  alertId: string | null;
  beforeValue: number | null;
  createdAt: number;
  completedAt: number | null;
}
