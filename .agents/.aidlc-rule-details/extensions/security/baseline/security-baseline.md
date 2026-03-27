# Baseline Security Rules

## Overview
These security rules are MANDATORY cross-cutting constraints that apply across all AI-DLC phases. They are not optional guidance — they are hard constraints that stages MUST enforce when generating questions, producing design artifacts, generating code, and presenting completion messages.

**Enforcement**: At each applicable stage, the model MUST verify compliance with these rules before presenting the stage completion message to the user.

### Blocking Security Finding Behavior
A **blocking security finding** means:
1. The finding MUST be listed in the stage completion message under a "Security Findings" section with the SECURITY rule ID and description
2. The stage MUST NOT present the "Continue to Next Stage" option until all blocking findings are resolved
3. The model MUST present only the "Request Changes" option with a clear explanation of what needs to change
4. The finding MUST be logged in `aidlc-docs/audit.md` with the SECURITY rule ID, description, and stage context

If a SECURITY rule is not applicable to the current project (e.g., SECURITY-01 when no data stores exist), mark it as **N/A** in the compliance summary — this is not a blocking finding.

### Default Enforcement
All rules in this document are **blocking** by default. If any rule's verification criteria are not met, it is a blocking security finding — follow the blocking finding behavior defined above.

### Verification Criteria Format
Verification items in this document are plain bullet points describing compliance checks. They are distinct from the `- [ ]` / `- [x]` progress-tracking checkboxes used in stage plan files. Each item should be evaluated as compliant or non-compliant during review.

---

## Rule SECURITY-01: Encryption at Rest and in Transit

**Rule**: Every data persistence store (databases, object storage, file systems, caches, or any equivalent) MUST have:
- Encryption at rest enabled using a managed key service or customer-managed keys
- Encryption in transit enforced (TLS 1.2+ for all data movement in and out of the store)

**Verification**:
- No storage resource is defined without an encryption configuration block
- No database connection string uses an unencrypted protocol
- Object storage enforces encryption at rest and rejects non-TLS requests via policy
- Database instances have storage encryption enabled and enforce TLS connections

---

## Rule SECURITY-02: Access Logging on Network Intermediaries

**Rule**: Every network-facing intermediary that handles external traffic MUST have access logging enabled. This includes:
- Load balancers → access logs to a persistent store
- API gateways → execution logging and access logging to a centralized log service
- CDN distributions → standard logging or real-time logs

**Verification**:
- No load balancer resource is defined without access logging enabled
- No API gateway stage is defined without access logging configured
- No CDN distribution is defined without logging configuration

---

## Rule SECURITY-03: Application-Level Logging

**Rule**: Every deployed application component MUST include structured logging infrastructure:
- A logging framework MUST be configured
- Log output MUST be directed to a centralized log service
- Logs MUST include: timestamp, correlation/request ID, log level, and message
- Sensitive data (passwords, tokens, PII) MUST NOT appear in log output

**Verification**:
- Every service/function entry point includes a configured logger
- No ad-hoc logging statements used as the primary logging mechanism in production code
- Log configuration routes output to a centralized log service
- No secrets, tokens, or PII are logged

---

## Rule SECURITY-04: HTTP Security Headers for Web Applications

**Rule**: The following HTTP response headers MUST be set on all HTML-serving endpoints:

| Header | Required Value |
|---|---|
| `Content-Security-Policy` | Define a restrictive policy (at minimum: `default-src 'self'`) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (or `SAMEORIGIN` if framing is required) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

**Note**: `X-XSS-Protection` is deprecated in modern browsers. Use `Content-Security-Policy` instead.

**Verification**:
- Middleware or response interceptor sets all required headers
- CSP policy does not use `unsafe-inline` or `unsafe-eval` without documented justification
- HSTS max-age is at least 31536000 (1 year)

---

## Rule SECURITY-05: Input Validation on All API Parameters

**Rule**: Every API endpoint (REST, GraphQL, gRPC, WebSocket) MUST validate all input parameters before processing. Validation MUST include:
- **Type checking**: Reject unexpected types
- **Length/size bounds**: Enforce maximum lengths on strings, maximum sizes on arrays and payloads
- **Format validation**: Use allowlists (regex or schema) for structured inputs (emails, dates, IDs)
- **Sanitization**: Escape or reject HTML/script content in user-supplied strings to prevent XSS
- **Injection prevention**: Use parameterized queries for all database operations (never string concatenation)

**Verification**:
- Every API handler uses a validation library or schema
- No raw user input is concatenated into SQL, NoSQL, or OS commands
- String inputs have explicit max-length constraints
- Request body size limits are configured at the framework or gateway level

---

## Rule SECURITY-06: Least-Privilege Access Policies

**Rule**: Every identity and access management policy, role, or permission boundary MUST follow least privilege:
- Use specific resource identifiers — NEVER use wildcard resources unless the API does not support resource-level permissions (document the exception)
- Use specific actions — NEVER use wildcard actions
- Scope conditions where possible
- Separate read and write permissions into distinct policy statements

**Verification**:
- No policy contains wildcard actions or wildcard resources without a documented exception
- No service role has broader permissions than what the service actually calls
- Inline policies are avoided in favor of managed policies where possible
- Every role has a trust policy scoped to the specific service or account

---

## Rule SECURITY-07: Restrictive Network Configuration

**Rule**: All network configurations (security groups, network ACLs, route tables) MUST follow deny-by-default:
- Firewall rules: Only open specific ports required by the application
- No inbound rule with source `0.0.0.0/0` except for public-facing load balancers on ports 80/443
- No outbound rule with `0.0.0.0/0` on all ports unless explicitly justified
- Private subnets MUST NOT have direct internet gateway routes
- Use private endpoints for cloud service access where available

**Verification**:
- No firewall rule allows inbound `0.0.0.0/0` on any port other than 80/443 on a public load balancer
- Database and application firewall rules restrict source to specific CIDR blocks or security group references
- Private subnets route through a NAT gateway (not an internet gateway)
- Private endpoints are used for high-traffic cloud service calls

---

## Rule SECURITY-08: Application-Level Access Control

**Rule**: Every application endpoint that accesses or mutates a resource MUST enforce authorization checks at the application layer:
- **Deny by default**: All routes/endpoints MUST require authentication unless explicitly marked as public
- **Object-level authorization**: Every request that references a resource by ID MUST verify the requesting user/principal owns or has permission to access that resource (prevent IDOR)
- **Function-level authorization**: Administrative or privileged operations MUST check the caller's role/permissions server-side — never rely on client-side hiding
- **CORS policy**: Cross-origin resource sharing MUST be restricted to explicitly allowed origins — never use `Access-Control-Allow-Origin: *` on authenticated endpoints
- **Token validation**: JWTs or session tokens MUST be validated server-side on every request (signature, expiration, audience, issuer)

**Verification**:
- Every controller/handler has an authorization middleware or guard applied
- No endpoint returns data for a resource ID without verifying the caller's ownership or permission
- Admin/privileged routes have explicit role checks enforced server-side
- CORS configuration does not use wildcard origins on authenticated endpoints
- Token validation occurs server-side on every request (not just at login)

---

## Rule SECURITY-09: Security Hardening and Misconfiguration Prevention

**Rule**: All deployed components MUST follow a hardening baseline:
- **No default credentials**: Default usernames/passwords MUST be changed or disabled before deployment
- **Minimal installation**: Remove or disable unused features, frameworks, sample applications, and documentation endpoints
- **Error handling**: Production error responses MUST NOT expose stack traces, internal paths, framework versions, or database details to end users
- **Directory listing**: Web servers MUST disable directory listing
- **Cloud storage**: Cloud object storage MUST block public access unless explicitly required and documented
- **Patch management**: Runtime environments, frameworks, and OS images MUST use current, supported versions

**Verification**:
- No default credentials exist in configuration files, environment variables, or IaC templates
- Error responses in production return generic messages (no stack traces or internal details)
- Cloud object storage has public access blocked unless a documented exception exists
- No sample/demo applications or default pages are deployed
- Framework and runtime versions are current and supported


---

## Rule SECURITY-10: Software Supply Chain Security

**Rule**: Every project MUST manage its software supply chain:
- **Dependency pinning**: All dependencies MUST use exact versions or lock files
- **Vulnerability scanning**: A dependency vulnerability scanner MUST be configured 
- **No unused dependencies**: Remove packages that are not actively used
- **Trusted sources only**: Dependencies MUST be pulled from official registries or verified private registries — no unvetted third-party sources
- **SBOM**: Projects MUST generate a Software Bill of Materials for production deployments
- **CI/CD integrity**: Build pipelines MUST use pinned tool versions and verified base images — no `latest` tags in production Dockerfiles or CI configurations

**Verification**:
- A lock file exists and is committed to version control
- A dependency vulnerability scanning step is included in CI/CD or documented in build instructions
- No unused or abandoned dependencies are included
- Dockerfiles and CI configs do not use `latest` or unpinned image tags for production
- Dependencies are sourced from official or verified registries

---

## Rule SECURITY-11: Secure Design Principles

**Rule**: Application design MUST incorporate security from the start:
- **Separation of concerns**: Security-critical logic (authentication, authorization, payment processing) MUST be isolated in dedicated modules — not scattered across the codebase
- **Defense in depth**: No single control should be the sole line of defense — layer controls (validation + authorization + encryption)
- **Rate limiting**: Public-facing endpoints MUST implement rate limiting or throttling to prevent abuse
- **Business logic abuse**: Design MUST consider misuse cases — not just happy-path scenarios

**Verification**:
- Security-critical logic is encapsulated in dedicated modules or services
- Rate limiting is configured on public-facing APIs
- Design documentation addresses at least one misuse/abuse scenario

---

## Rule SECURITY-12: Authentication and Credential Management

**Rule**: Every application with user authentication MUST implement:
- **Password policy**: Minimum 8 characters, check against breached password lists
- **Credential storage**: Passwords MUST be hashed using adaptive algorithms — never weak or non-adaptive hashing
- **Multi-factor authentication**: MFA MUST be supported for administrative accounts and SHOULD be available for all users
- **Session management**: Sessions MUST have server-side expiration, be invalidated on logout, and use secure/httpOnly/sameSite cookie attributes
- **Brute-force protection**: Login endpoints MUST implement account lockout, progressive delays, or CAPTCHA after repeated failures
- **No hardcoded credentials**: No passwords, API keys, or secrets in source code or IaC templates — use a secrets manager

**Verification**:
- Password hashing uses adaptive algorithms (not weak or non-adaptive hashing)
- Session cookies set `Secure`, `HttpOnly`, and `SameSite` attributes
- Login endpoints have brute-force protection (lockout, delay, or CAPTCHA)
- No hardcoded credentials in source code or configuration files
- MFA is supported for admin accounts
- Sessions are invalidated on logout and have a defined expiration

---

## Rule SECURITY-13: Software and Data Integrity Verification

**Rule**: Systems MUST verify the integrity of software and data:
- **Deserialization safety**: Untrusted data MUST NOT be deserialized without validation — use safe deserialization libraries or allowlists of permitted types
- **Artifact integrity**: Downloaded dependencies, plugins, and updates MUST be verified via checksums or digital signatures
- **CI/CD pipeline security**: Build pipelines MUST restrict who can modify pipeline definitions — separate duties between code authors and deployment approvers
- **CDN and external resources**: Scripts or resources loaded from external CDNs MUST use Subresource Integrity (SRI) hashes
- **Data integrity**: Critical data modifications MUST be auditable (who changed what, when)

**Verification**:
- No unsafe deserialization of untrusted input
- External scripts include SRI integrity attributes when loaded from CDNs
- CI/CD pipeline definitions are access-controlled and changes are auditable
- Critical data changes are logged with actor, timestamp, and before/after values

---

## Rule SECURITY-14: Alerting and Monitoring

**Rule**: In addition to logging (SECURITY-02, SECURITY-03), systems MUST include:
- **Security event alerting**: Alerts MUST be configured for high-value security events: repeated authentication failures, privilege escalation attempts, access from unusual locations, and authorization failures
- **Log integrity**: Logs MUST be stored in append-only or tamper-evident storage — application code MUST NOT be able to delete or modify its own audit logs
- **Log retention**: Logs MUST be retained for a minimum period appropriate to the application's compliance requirements (default: 90 days minimum)
- **Monitoring dashboards**: A monitoring dashboard or alarm configuration MUST be defined for key operational and security metrics

**Verification**:
- Alerting is configured for authentication failures and authorization violations
- Application log groups have retention policies set (minimum 90 days)
- Application roles do not have permission to delete their own log groups/streams
- Security-relevant events (login failures, access denied, privilege changes) generate alerts

---

## Rule SECURITY-15: Exception Handling and Fail-Safe Defaults

**Rule**: Every application MUST handle exceptional conditions safely:
- **Catch and handle**: All external calls (database, API, file I/O) MUST have explicit error handling — no unhandled promise rejections or uncaught exceptions in production
- **Fail closed**: On error, the system MUST deny access or halt the operation — never fail open
- **Resource cleanup**: Error paths MUST release resources (connections, file handles, locks) — use try/finally, using statements, or equivalent patterns
- **User-facing errors**: Error messages shown to users MUST be generic — no internal details or system information
- **Global error handler**: Applications MUST have a global/top-level error handler that catches unhandled exceptions, logs them (per SECURITY-03), and returns a safe response

**Verification**:
- All external calls (DB, HTTP, file I/O) have explicit error handling (try/catch, .catch(), error callbacks)
- A global error handler is configured at the application entry point
- Error paths do not bypass authorization or validation checks (fail closed)
- Resources are cleaned up in error paths (connections closed, transactions rolled back)
- No unhandled promise rejections or uncaught exception warnings in application code

---

## Enforcement Integration

These rules are cross-cutting constraints that apply to every AI-DLC stage. At each stage:
- Evaluate all SECURITY rule verification criteria against the artifacts produced
- Include a "Security Compliance" section in the stage completion summary listing each rule as compliant, non-compliant, or N/A
- If any rule is non-compliant, this is a blocking security finding — follow the blocking finding behavior defined in the Overview
- Include security rule references in design documentation and test instructions

---

## Appendix: OWASP Reference Mapping

For human reviewers, the following maps SECURITY rules to OWASP Top 10 (2025) categories:

| SECURITY Rule | OWASP Category |
|---|---|
| SECURITY-08 | A01:2025 – Broken Access Control |
| SECURITY-09 | A02:2025 – Security Misconfiguration |
| SECURITY-10 | A03:2025 – Software Supply Chain Failures |
| SECURITY-11 | A06:2025 – Insecure Design |
| SECURITY-12 | A07:2025 – Authentication Failures |
| SECURITY-13 | A08:2025 – Software or Data Integrity Failures |
| SECURITY-14 | A09:2025 – Logging & Alerting Failures |
| SECURITY-15 | A10:2025 – Mishandling of Exceptional Conditions |
