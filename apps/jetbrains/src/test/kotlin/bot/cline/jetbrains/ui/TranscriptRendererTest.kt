package bot.cline.jetbrains.ui

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptRendererTest {
	@Test
	fun `escapes html`() {
		assertEquals("&lt;b&gt; &amp; &quot;x&quot;", TranscriptRenderer.escape("<b> & \"x\""))
	}

	@Test
	fun `renders fenced code blocks and inline markup`() {
		val html = TranscriptRenderer.markdownToHtml("The output of `cat hello.txt` is:\n\n```\nhello <world>\n```\n\n**Done**")
		assertTrue(html.contains("<code>cat hello.txt</code>"))
		assertTrue(html.contains("<pre>hello &lt;world&gt;</pre>"))
		assertTrue(html.contains("<b>Done</b>"))
	}

	@Test
	fun `renders an unterminated fence while streaming`() {
		val html = TranscriptRenderer.markdownToHtml("Here:\n```kotlin\nval x = 1")
		assertTrue(html.contains("<pre>val x = 1</pre>"))
	}

	@Test
	fun `renders bullet lists`() {
		val html = TranscriptRenderer.markdownToHtml("- one\n- two\ntext")
		assertTrue(html.contains("<ul><li>one</li><li>two</li></ul>"))
		assertTrue(html.contains("text<br>"))
	}

	@Test
	fun `summarizes tool input and output`() {
		val input = JsonParser.parseString("""{"commands":["cat hello.txt","ls"]}""")
		assertEquals("cat hello.txt && ls", TranscriptRenderer.summarizeInput("run_commands", input))
		assertEquals("src/a.kt", TranscriptRenderer.summarizeInput("read_file", JsonParser.parseString("""{"path":"src/a.kt"}""")))
		val output = JsonParser.parseString("""[{"query":"cat hello.txt","result":"hello\n","success":true}]""")
		assertEquals("hello\n", TranscriptRenderer.summarizeOutput(output))
		assertEquals("plain", TranscriptRenderer.summarizeOutput(JsonParser.parseString("\"plain\"")))
	}

	@Test
	fun `truncates long text`() {
		val text = "x".repeat(50)
		val truncated = TranscriptRenderer.truncate(text, 10)
		assertTrue(truncated.startsWith("xxxxxxxxxx\n"))
		assertTrue(truncated.contains("40 more characters"))
	}
}
