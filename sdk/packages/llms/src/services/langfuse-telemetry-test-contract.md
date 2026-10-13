# Telemetry architecture merge: test guarantee mapping

Baseline: client #13974 at `42a700f2d` (27 telemetry tests).
Integrated: #14070 at `368082480` (26 unit cases and eight real-stream cases
before the collector-contract case added here). A test count is not a coverage
equivalence claim: the direct-export ownership contract deliberately changes.

| Baseline guarantee | Combined coverage / intentional change |
| --- | --- |
| Non-Cline exclusion before/after initialization; Cline/ClinePass enablement | `keeps third-party providers disabled before and after direct initialization`; `shares one isolated exporter between concurrent Cline backend requests` |
| Flush before shutdown | `uses direct credentials even when a non-relay host owns an immutable tracer` asserts SDK-owned flush-before-shutdown and no host cleanup |
| Direct/proxy relay marker suppresses duplicate direct export | `recognizes a relay marker directly on the global provider`, `never registers cleanup or touches the host when direct export is declined`, `takes the relay path even after direct integration has been cached`, and real-stream direct/relay coexistence |
| Direct exporter attaches to mutable host or proxy delegate | **Replaced intentionally:** it now uses an isolated provider and never attaches to a foreign host. Real-stream host-alive-after-cleanup and unrelated-call checks protect isolation |
| Minified/no-op global provider can be replaced; reject registration failure or immutable foreign slot | **Replaced intentionally:** direct export no longer claims a global slot, so foreign immutability/rejected registration is not a reason to disable valid credentials. The immutable-host test proves direct export succeeds without modifying the host |
| Direct content/opt-out behavior | Existing direct-path decision and direct-opt-out tests retained; real-stream direct export proves integration selection |
| Default 100%, explicit 0, metadata-only, content flag | Existing decision cases retained; real-stream content absence/presence cases added |
| Stable task hash and missing-key rejection below 100% | Existing decision cases retained; sampled-out stream emits no spans |
| Global opt-out, malformed JSON, unreadable file, explicit false | Existing cases retained; real-stream mid-session opt-out added |
| Console-only tracer does not count as relay | Existing case retained; immutable non-relay direct host and real-stream host ownership also covered |
| Direct resumes after relay goes away | Existing case retained; isolated direct runtime recreated after disposal |
| Missing host/config stays disabled | Existing case retained; incomplete credentials explicitly covered |
| Real AI SDK call invokes registered integration | **Replaced intentionally:** per-call integration instead of global registration; real stream emits spans while unrelated SDK calls inherit no integration |

Additional coverage protects relay registration during asynchronous direct
initialization (sampling off, opted out, metadata-only), tracer replacement,
standalone async trace context, and actual generation/step/tool scope/parent
contracts used by the infra fixture. Extension lifecycle tests remain separate;
the shared SDK tests do not prove extension retention/disposal or packaging.