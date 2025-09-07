ALTER TABLE "runs" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "contextWindow" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "inputPrice" real;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "outputPrice" real;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cacheWritesPrice" real;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cacheReadsPrice" real;