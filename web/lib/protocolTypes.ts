export interface WellnessProtocol {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_days: number;
  start_date: string;
  status: 'active' | 'completed' | 'abandoned';
  tasks: ProtocolTask[];
  created_at: string;
}

export interface ProtocolTask {
  id: string;
  name: string;
  time: 'am' | 'pm' | 'any';
}

export interface WellnessProtocolLog {
  protocol_id: string;
  user_id: string;
  log_date: string; // YYYY-MM-DD
  completed_task_ids: string[];
}
