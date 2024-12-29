export interface IProviderSetting {
  enabled?: boolean;
  [key: string]: any;
}

export interface ProviderInfo {
  name: string;
  settings: IProviderSetting;
  [key: string]: any;
}