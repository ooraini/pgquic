export type Persona = "employee" | "manager" | "hr";

export type Profile = {
  id: string;
  display_name: string;
  title: string;
  persona: Persona;
  allowance_days: number;
  visible_requests: string;
};

export type RequestRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_title: string;
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "cancelled";
  manager_note: string | null;
  updated_at: string;
  is_mine: boolean;
  is_direct_report: boolean;
};

export type AuditRow = {
  id: string;
  request_id: string;
  actor: string;
  actor_name: string | null;
  action: string;
  from_status: string | null;
  to_status: string;
  occurred_at: string;
};

export type SecurityInfo = {
  current_user: string;
  session_user: string;
  is_employee: boolean;
  is_manager: boolean;
  is_hr: boolean;
  row_security: string;
};

export type DatabaseCommand = (
  key: string,
  text: string,
  values: unknown[],
  success: string,
) => Promise<void>;
