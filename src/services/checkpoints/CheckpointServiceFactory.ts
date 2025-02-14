import { LocalCheckpointService, LocalCheckpointServiceOptions } from "./LocalCheckpointService"
import { ShadowCheckpointService, ShadowCheckpointServiceOptions } from "./ShadowCheckpointService"

export type CreateCheckpointServiceFactoryOptions =
	| {
			strategy: "local"
			options: LocalCheckpointServiceOptions
	  }
	| {
			strategy: "shadow"
			options: ShadowCheckpointServiceOptions
	  }

type CheckpointServiceType<T extends CreateCheckpointServiceFactoryOptions> = T extends { strategy: "local" }
	? LocalCheckpointService
	: T extends { strategy: "shadow" }
		? ShadowCheckpointService
		: never

export class CheckpointServiceFactory {
	public static create<T extends CreateCheckpointServiceFactoryOptions>(options: T): CheckpointServiceType<T> {
		switch (options.strategy) {
			case "local":
				return LocalCheckpointService.create(options.options) as any
			case "shadow":
				return ShadowCheckpointService.create(options.options) as any
		}
	}
}
