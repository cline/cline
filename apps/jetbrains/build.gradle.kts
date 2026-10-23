import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
	id("java")
	id("org.jetbrains.kotlin.jvm") version "2.4.21"
	id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
	jvmToolchain(21)
	compilerOptions {
		// Without this Kotlin re-declares every default method of implemented
		// platform interfaces (e.g. ToolWindowFactory) as bridges, which the
		// Plugin Verifier then reports as deprecated/internal API overrides.
		freeCompilerArgs.add("-Xjvm-default=all")
	}
}

repositories {
	mavenCentral()
	intellijPlatform {
		defaultRepositories()
	}
}

dependencies {
	intellijPlatform {
		create(providers.gradleProperty("platformType"), providers.gradleProperty("platformVersion"))
		testFramework(TestFrameworkType.Platform)
	}

	testImplementation("junit:junit:4.13.2")
	testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
	pluginConfiguration {
		name = providers.gradleProperty("pluginName")
		version = providers.gradleProperty("pluginVersion")
		ideaVersion {
			sinceBuild = providers.gradleProperty("pluginSinceBuild")
			untilBuild = provider { null }
		}
	}
	pluginVerification {
		ides {
			recommended()
		}
	}
}

tasks {
	wrapper {
		gradleVersion = providers.gradleProperty("gradleVersion").get()
	}

	test {
		// Live hub integration tests self-skip when no hub is reachable; this
		// keeps their output visible when one is.
		testLogging {
			events("passed", "skipped", "failed")
			showStandardStreams = true
		}
	}

	runIde {
		// Headless containers: let the sandbox IDE start without the
		// first-run wizards and point it at an explicit display.
		systemProperty("idea.trust.all.projects", "true")
		systemProperty("ide.show.tips.on.startup", "false")
		systemProperty("jb.consents.confirmation.enabled", "false")
		systemProperty("idea.initially.ask.config", "never")
	}
}
