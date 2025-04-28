export const sampleScala = `
package com.example.test

import scala.collection.mutable
import scala.concurrent.Future

// Regular class with type parameters
class Container[A, B](val first: A, val second: B) {
  def swap: Container[B, A] = new Container(second, first)
}

// Case class with type parameters
case class TestCaseClass[A, B](
  field1: A,
  field2: B,
  field3: List[A]
)(implicit ctx: Context)

// Abstract class
abstract class AbstractBase {
  def abstractMethod: String
  val abstractValue: Int
}

// Trait with abstract type member
trait TestTrait {
  type T
  def method[A](
    param1: A,
    param2: List[T]
  ): Option[A]
}

// Object companion
object TestTrait {
  def apply[T](value: T): TestTrait = ???
}

// Case object
case object SingletonValue extends AbstractBase {
  def abstractMethod: String = "implemented"
  val abstractValue: Int = 42
}

// Class with pattern matching
class PatternMatcher {
  def testMatch(value: Any): Int = value match {
    case s: String =>
      s.length
    case n: Int if n > 0 =>
      n * 2
    case _ =>
      0
  }
}

// Implicit class for extension methods
implicit class RichString(val str: String) {
  def truncate(maxLength: Int): String =
    if (str.length <= maxLength) str
    else str.take(maxLength) + "..."
}

// Type alias and lazy val
object Types {
  type StringMap[T] = Map[String, T]
  
  lazy val heavyComputation: Int = {
    Thread.sleep(1000)
    42
  }
}

// For comprehension example
class ForComprehension {
  def processItems(items: List[Int]): List[Int] = {
    for {
      item <- items
      if item > 0
      doubled = item * 2
      if doubled < 100
    } yield doubled
  }
}

// Var and val definitions
object Variables {
  val immutableValue: Int = 42
  var mutableValue: String = "changeable"
  
  private lazy val lazyValue: Double = {
    math.random()
  }
}`
