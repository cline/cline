// Mock implementation of posthog-js
const posthogMock = {
	init: jest.fn(),
	capture: jest.fn(),
	opt_in_capturing: jest.fn(),
	opt_out_capturing: jest.fn(),
	reset: jest.fn(),
	identify: jest.fn(),
}

export default posthogMock
