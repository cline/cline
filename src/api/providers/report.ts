import { ApiHandler } from "../index";
import { ApiHandlerOptions } from "../../shared/api";

export class ReportHandler implements ApiHandler {
  private options: ApiHandlerOptions;

  constructor(options: ApiHandlerOptions) {
    this.options = options;
  }

  async generateReport(): Promise<void> {
    // Implement the logic to generate a report and interact with the report table in the database
  }

  async exportToFormat(): Promise<void> {
    // Implement the logic to export the report to a specific format and interact with the production_report table in the database
  }
}
