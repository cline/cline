export const sampleOCaml = `
(* Module with signature *)
module StringSet : sig
  type t
  val empty: t
  val add: string -> t -> t
  val mem: string -> t -> bool
end = struct
  type t = string list
  let empty = []
  let add x s = x :: s
  let mem = List.mem
end

(* Functor definition *)
module OrderedMap (Key: sig
  type t
  val compare: t -> t -> int
end) = struct
  type 'a t = (Key.t * 'a) list
  let empty = []
  let add k v map = (k, v) :: map
end

(* Variant type definition *)
type shape =
  | Rectangle of float * float  (* width * height *)
  | Circle of float            (* radius *)
  | Triangle of float * float * float  (* sides *)

(* Record type definition *)
type person = {
  name: string;
  age: int;
  address: string option;
  phone: string list;
}

(* Pattern matching function *)
let rec process_list = function
  | [] -> None
  | x :: xs when x > 0 -> Some x
  | _ :: xs -> process_list xs

(* Multi-argument function *)
let calculate_area ~width ~height ?(margin=0) ?(padding=0) () =
  let total_width = width + (2 * margin) + (2 * padding) in
  let total_height = height + (2 * margin) + (2 * padding) in
  total_width * total_height

(* Class definition with inheritance *)
class virtual ['a] container = object (self)
  val mutable items : 'a list = []
  method virtual add : 'a -> unit
  method get_items = items
  method clear = items <- []
end

(* Object expression *)
let make_counter initial = object
  val mutable count = initial
  method increment = count <- count + 1
  method decrement = count <- count - 1
  method get_count = count
end
`
