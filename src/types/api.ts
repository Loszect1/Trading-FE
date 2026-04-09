export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errorCode?: string;
}

export interface AppError {
  message: string;
  status?: number;
  errorCode?: string;
}
