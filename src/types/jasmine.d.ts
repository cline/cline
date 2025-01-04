declare module "jasmine" {
	export type Spy = jasmine.Spy
	export const createSpy: typeof jasmine.createSpy
	export const spyOn: typeof jasmine.spyOn
}
