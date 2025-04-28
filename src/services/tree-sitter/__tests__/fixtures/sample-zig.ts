export const sampleZig = `
const std = @import("std");

// A basic struct
pub const Point = struct {
    x: f32,
    y: f32,

    pub fn init(x: f32, y: f32) Point {
        return Point{ .x = x, .y = y };
    }

    pub fn distance(self: Point) f32 {
        return @sqrt(self.x * self.x + self.y * self.y);
    }
};

// A function definition
pub fn main() !void {
    const point = Point.init(3.0, 4.0);
    const dist = point.distance();
    std.debug.print("Distance: {d}\n", .{dist});
}

// An enum definition
const Direction = enum {
    North,
    South,
    East,
    West,
};

// Global variables
var global_point: Point = undefined;
pub const VERSION: u32 = 1;

// A type definition
pub const Vector = struct {
    direction: Direction,
    magnitude: f32,
};
`
