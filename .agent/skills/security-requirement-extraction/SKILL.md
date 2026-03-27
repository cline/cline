---
name: security-requirement-extraction
description: Derive security requirements from threat models and business context. Use when translating threats into actionable requirements, creating security user stories, or building security test cases.
---

# Security Requirement Extraction

Transform threat analysis into actionable security requirements.

## When to Use This Skill

- Converting threat models to requirements
- Writing security user stories
- Creating security test cases
- Building security acceptance criteria
- Compliance requirement mapping
- Security architecture documentation

## Core Concepts

### 1. Requirement Categories

```
Business Requirements → Security Requirements → Technical Controls
         ↓                       ↓                      ↓
  "Protect customer    "Encrypt PII at rest"   "AES-256 encryption
   data"                                        with KMS key rotation"
```

### 2. Security Requirement Types

| Type               | Focus                   | Example                               |
| ------------------ | ----------------------- | ------------------------------------- |
| **Functional**     | What system must do     | "System must authenticate users"      |
| **Non-functional** | How system must perform | "Authentication must complete in <2s" |
| **Constraint**     | Limitations imposed     | "Must use approved crypto libraries"  |

### 3. Requirement Attributes

| Attribute        | Description                 |
| ---------------- | --------------------------- |
| **Traceability** | Links to threats/compliance |
| **Testability**  | Can be verified             |
| **Priority**     | Business importance         |
| **Risk Level**   | Impact if not met           |

## Templates

### Template 1: Security Requirement Model

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Optional, Set
from datetime import datetime

class RequirementType(Enum):
    FUNCTIONAL = "functional"
    NON_FUNCTIONAL = "non_functional"
    CONSTRAINT = "constraint"


class Priority(Enum):
    CRITICAL = 1
    HIGH = 2
    MEDIUM = 3
    LOW = 4


class SecurityDomain(Enum):
    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    DATA_PROTECTION = "data_protection"
    AUDIT_LOGGING = "audit_logging"
    INPUT_VALIDATION = "input_validation"
    ERROR_HANDLING = "error_handling"
    SESSION_MANAGEMENT = "session_management"
    CRYPTOGRAPHY = "cryptography"
    NETWORK_SECURITY = "network_security"
    AVAILABILITY = "availability"


class ComplianceFramework(Enum):
    PCI_DSS = "pci_dss"
    HIPAA = "hipaa"
    GDPR = "gdpr"
    SOC2 = "soc2"
    NIST_CSF = "nist_csf"
    ISO_27001 = "iso_27001"
    OWASP = "owasp"


@dataclass
class SecurityRequirement:
    id: str
    title: str
    description: str
    req_type: RequirementType
    domain: SecurityDomain
    priority: Priority
    rationale: str = ""
    acceptance_criteria: List[str] = field(default_factory=list)
    test_cases: List[str] = field(default_factory=list)
    threat_refs: List[str] = field(default_factory=list)
    compliance_refs: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    status: str = "draft"
    owner: str = ""
    created_date: datetime = field(default_factory=datetime.now)

    def to_user_story(self) -> str:
        """Convert to user story format."""
        return f"""
**{self.id}: {self.title}**

As a security-conscious system,
I need to {self.description.lower()},
So that {self.rationale.lower()}.

**Acceptance Criteria:**
{chr(10).join(f'- [ ] {ac}' for ac in self.acceptance_criteria)}

**Priority:** {self.priority.name}
**Domain:** {self.domain.value}
**Threat References:** {', '.join(self.threat_refs)}
"""

    def to_test_spec(self) -> str:
        """Convert to test specification."""
        return f"""
## Test Specification: {self.id}

### Requirement
{self.description}

### Test Cases
{chr(10).join(f'{i+1}. {tc}' for i, tc in enumerate(self.test_cases))}

### Acceptance Criteria Verification
{chr(10).join(f'- {ac}' for ac in self.acceptance_criteria)}
"""


@dataclass
class RequirementSet:
    name: str
    version: str
    requirements: List[SecurityRequirement] = field(default_factory=list)

    def add(self, req: SecurityRequirement) -> None:
        self.requirements.append(req)

    def get_by_domain(self, domain: SecurityDomain) -> List[SecurityRequirement]:
        return [r for r in self.requirements if r.domain == domain]

    def get_by_priority(self, priority: Priority) -> List[SecurityRequirement]:
        return [r for r in self.requirements if r.priority == priority]

    def get_by_threat(self, threat_id: str) -> List[SecurityRequirement]:
        return [r for r in self.requirements if threat_id in r.threat_refs]

    def get_critical_requirements(self) -> List[SecurityRequirement]:
        return [r for r in self.requirements if r.priority == Priority.CRITICAL]

    def export_markdown(self) -> str:
        """Export all requirements as markdown."""
        lines = [f"# Security Requirements: {self.name}\n"]
        lines.append(f"Version: {self.version}\n")

        for domain in SecurityDomain:
            domain_reqs = self.get_by_domain(domain)
            if domain_reqs:
                lines.append(f"\n## {domain.value.replace('_', ' ').title()}\n")
                for req in domain_reqs:
                    lines.append(req.to_user_story())

        return "\n".join(lines)

    def traceability_matrix(self) -> Dict[str, List[str]]:
        """Generate threat-to-requirement traceability."""
        matrix = {}
        for req in self.requirements:
            for threat_id in req.threat_refs:
                if threat_id not in matrix:
                    matrix[threat_id] = []
                matrix[threat_id].append(req.id)
        return matrix
```

### Template 2: Threat-to-Requirement Extractor

```python
from dataclasses import dataclass
from typing import List, Dict, Tuple

@dataclass
class ThreatInput:
    id: str
    category: str  # STRIDE category
    title: str
    description: str
    target: str
    impact: str
    likelihood: str


class RequirementExtractor:
    """Extract security requirements from threats."""

    # Mapping of STRIDE categories to security domains and requirement patterns
    STRIDE_MAPPINGS = {
        "SPOOFING": {
            "domains": [SecurityDomain.AUTHENTICATION, SecurityDomain.SESSION_MANAGEMENT],
            "patterns": [
                ("Implement strong authentication for {target}",
                 "Ensure {target} authenticates all users before granting access"),
                ("Validate identity tokens for {target}",
                 "All authentication tokens must be cryptographically verified"),
                ("Implement session management for {target}",
                 "Sessions must be securely managed with proper expiration"),
            ]
        },
        "TAMPERING": {
            "domains": [SecurityDomain.INPUT_VALIDATION, SecurityDomain.DATA_PROTECTION],
            "patterns": [
                ("Validate all input to {target}",
                 "All input must be validated against expected formats"),
                ("Implement integrity checks for {target}",
                 "Data integrity must be verified using cryptographic signatures"),
                ("Protect {target} from modification",
                 "Implement controls to prevent unauthorized data modification"),
            ]
        },
        "REPUDIATION": {
            "domains": [SecurityDomain.AUDIT_LOGGING],
            "patterns": [
                ("Log all security events for {target}",
                 "Security-relevant events must be logged for audit purposes"),
                ("Implement non-repudiation for {target}",
                 "Critical actions must have cryptographic proof of origin"),
                ("Protect audit logs for {target}",
                 "Audit logs must be tamper-evident and protected"),
            ]
        },
        "INFORMATION_DISCLOSURE": {
            "domains": [SecurityDomain.DATA_PROTECTION, SecurityDomain.CRYPTOGRAPHY],
            "patterns": [
                ("Encrypt sensitive data in {target}",
                 "Sensitive data must be encrypted at rest and in transit"),
                ("Implement access controls for {target}",
                 "Data access must be restricted based on need-to-know"),
                ("Prevent information leakage from {target}",
                 "Error messages and logs must not expose sensitive information"),
            ]
        },
        "DENIAL_OF_SERVICE": {
            "domains": [SecurityDomain.AVAILABILITY, SecurityDomain.INPUT_VALIDATION],
            "patterns": [
                ("Implement rate limiting for {target}",
                 "Requests must be rate-limited to prevent resource exhaustion"),
                ("Ensure availability of {target}",
                 "System must remain available under high load conditions"),
                ("Implement resource quotas for {target}",
                 "Resource consumption must be bounded and monitored"),
            ]
        },
        "ELEVATION_OF_PRIVILEGE": {
            "domains": [SecurityDomain.AUTHORIZATION],
            "patterns": [
                ("Enforce authorization for {target}",
                 "All actions must be authorized based on user permissions"),
                ("Implement least privilege for {target}",
                 "Users must only have minimum necessary permissions"),
                ("Validate permissions for {target}",
                 "Permission checks must be performed server-side"),
            ]
        },
    }

    def extract_requirements(
        self,
        threats: List[ThreatInput],
        project_name: str
    ) -> RequirementSet:
        """Extract security requirements from threats."""
        req_set = RequirementSet(
            name=f"{project_name} Security Requirements",
            version="1.0"
        )

        req_counter = 1
        for threat in threats:
            reqs = self._threat_to_requirements(threat, req_counter)
            for req in reqs:
                req_set.add(req)
            req_counter += len(reqs)

        return req_set

    def _threat_to_requirements(
        self,
        threat: ThreatInput,
        start_id: int
    ) -> List[SecurityRequirement]:
        """Convert a single threat to requirements."""
        requirements = []
        mapping = self.STRIDE_MAPPINGS.get(threat.category, {})
        domains = mapping.get("domains", [])
        patterns = mapping.get("patterns", [])

        priority = self._calculate_priority(threat.impact, threat.likelihood)

        for i, (title_pattern, desc_pattern) in enumerate(patterns):
            req = SecurityRequirement(
                id=f"SR-{start_id + i:03d}",
                title=title_pattern.format(target=threat.target),
                description=desc_pattern.format(target=threat.target),
                req_type=RequirementType.FUNCTIONAL,
                domain=domains[i % len(domains)] if domains else SecurityDomain.DATA_PROTECTION,
                priority=priority,
                rationale=f"Mitigates threat: {threat.title}",
                threat_refs=[threat.id],
                acceptance_criteria=self._generate_acceptance_criteria(
                    threat.category, threat.target
                ),
                test_cases=self._generate_test_cases(
                    threat.category, threat.target
                )
            )
            requirements.append(req)

        return requirements

    def _calculate_priority(self, impact: str, likelihood: str) -> Priority:
        """Calculate requirement priority from threat attributes."""
        score_map = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
        impact_score = score_map.get(impact.upper(), 2)
        likelihood_score = score_map.get(likelihood.upper(), 2)

        combined = impact_score * likelihood_score

        if combined >= 12:
            return Priority.CRITICAL
        elif combined >= 6:
            return Priority.HIGH
        elif combined >= 3:
            return Priority.MEDIUM
        return Priority.LOW

    def _generate_acceptance_criteria(
        self,
        category: str,
        target: str
    ) -> List[str]:
        """Generate acceptance criteria for requirement."""
        criteria_templates = {
            "SPOOFING": [
                f"Users must authenticate before accessing {target}",
                "Authentication failures are logged and monitored",
                "Multi-factor authentication is available for sensitive operations",
            ],
            "TAMPERING": [
                f"All input to {target} is validated",
                "Data integrity is verified before processing",
                "Modification attempts trigger alerts",
            ],
            "REPUDIATION": [
                f"All actions on {target} are logged with user identity",
                "Logs cannot be modified by regular users",
                "Log retention meets compliance requirements",
            ],
            "INFORMATION_DISCLOSURE": [
                f"Sensitive data in {target} is encrypted",
                "Access to sensitive data is logged",
                "Error messages do not reveal sensitive information",
            ],
            "DENIAL_OF_SERVICE": [
                f"Rate limiting is enforced on {target}",
                "System degrades gracefully under load",
                "Resource exhaustion triggers alerts",
            ],
            "ELEVATION_OF_PRIVILEGE": [
                f"Authorization is checked for all {target} operations",
                "Users cannot access resources beyond their permissions",
                "Privilege changes are logged and monitored",
            ],
        }
        return criteria_templates.get(category, [])

    def _generate_test_cases(
        self,
        category: str,
        target: str
    ) -> List[str]:
        """Generate test cases for requirement."""
        test_templates = {
            "SPOOFING": [
                f"Test: Unauthenticated access to {target} is denied",
                "Test: Invalid credentials are rejected",
                "Test: Session tokens cannot be forged",
            ],
            "TAMPERING": [
                f"Test: Invalid input to {target} is rejected",
                "Test: Tampered data is detected and rejected",
                "Test: SQL injection attempts are blocked",
            ],
            "REPUDIATION": [
                "Test: Security events are logged",
                "Test: Logs include sufficient detail for forensics",
                "Test: Log integrity is protected",
            ],
            "INFORMATION_DISCLOSURE": [
                f"Test: {target} data is encrypted in transit",
                f"Test: {target} data is encrypted at rest",
                "Test: Error messages are sanitized",
            ],
            "DENIAL_OF_SERVICE": [
                f"Test: Rate limiting on {target} works correctly",
                "Test: System handles burst traffic gracefully",
                "Test: Resource limits are enforced",
            ],
            "ELEVATION_OF_PRIVILEGE": [
                f"Test: Unauthorized access to {target} is denied",
                "Test: Privilege escalation attempts are blocked",
                "Test: IDOR vulnerabilities are not present",
            ],
        }
        return test_templates.get(category, [])
```

### Template 3: Compliance Mapping

```python
from typing import Dict, List, Set

class ComplianceMapper:
    """Map security requirements to compliance frameworks."""

    FRAMEWORK_CONTROLS = {
        ComplianceFramework.PCI_DSS: {
            SecurityDomain.AUTHENTICATION: ["8.1", "8.2", "8.3"],
            SecurityDomain.AUTHORIZATION: ["7.1", "7.2"],
            SecurityDomain.DATA_PROTECTION: ["3.4", "3.5", "4.1"],
            SecurityDomain.AUDIT_LOGGING: ["10.1", "10.2", "10.3"],
            SecurityDomain.NETWORK_SECURITY: ["1.1", "1.2", "1.3"],
            SecurityDomain.CRYPTOGRAPHY: ["3.5", "3.6", "4.1"],
        },
        ComplianceFramework.HIPAA: {
            SecurityDomain.AUTHENTICATION: ["164.312(d)"],
            SecurityDomain.AUTHORIZATION: ["164.312(a)(1)"],
            SecurityDomain.DATA_PROTECTION: ["164.312(a)(2)(iv)", "164.312(e)(2)(ii)"],
            SecurityDomain.AUDIT_LOGGING: ["164.312(b)"],
        },
        ComplianceFramework.GDPR: {
            SecurityDomain.DATA_PROTECTION: ["Art. 32", "Art. 25"],
            SecurityDomain.AUDIT_LOGGING: ["Art. 30"],
            SecurityDomain.AUTHORIZATION: ["Art. 25"],
        },
        ComplianceFramework.OWASP: {
            SecurityDomain.AUTHENTICATION: ["V2.1", "V2.2", "V2.3"],
            SecurityDomain.SESSION_MANAGEMENT: ["V3.1", "V3.2", "V3.3"],
            SecurityDomain.INPUT_VALIDATION: ["V5.1", "V5.2", "V5.3"],
            SecurityDomain.CRYPTOGRAPHY: ["V6.1", "V6.2"],
            SecurityDomain.ERROR_HANDLING: ["V7.1", "V7.2"],
            SecurityDomain.DATA_PROTECTION: ["V8.1", "V8.2", "V8.3"],
            SecurityDomain.AUDIT_LOGGING: ["V7.1", "V7.2"],
        },
    }

    def map_requirement_to_compliance(
        self,
        requirement: SecurityRequirement,
        frameworks: List[ComplianceFramework]
    ) -> Dict[str, List[str]]:
        """Map a requirement to compliance controls."""
        mapping = {}
        for framework in frameworks:
            controls = self.FRAMEWORK_CONTROLS.get(framework, {})
            domain_controls = controls.get(requirement.domain, [])
            if domain_controls:
                mapping[framework.value] = domain_controls
        return mapping

    def get_requirements_for_control(
        self,
        requirement_set: RequirementSet,
        framework: ComplianceFramework,
        control_id: str
    ) -> List[SecurityRequirement]:
        """Find requirements that satisfy a compliance control."""
        matching = []
        framework_controls = self.FRAMEWORK_CONTROLS.get(framework, {})

        for domain, controls in framework_controls.items():
            if control_id in controls:
                matching.extend(requirement_set.get_by_domain(domain))

        return matching

    def generate_compliance_matrix(
        self,
        requirement_set: RequirementSet,
        frameworks: List[ComplianceFramework]
    ) -> Dict[str, Dict[str, List[str]]]:
        """Generate compliance traceability matrix."""
        matrix = {}

        for framework in frameworks:
            matrix[framework.value] = {}
            framework_controls = self.FRAMEWORK_CONTROLS.get(framework, {})

            for domain, controls in framework_controls.items():
                for control in controls:
                    reqs = self.get_requirements_for_control(
                        requirement_set, framework, control
                    )
                    if reqs:
                        matrix[framework.value][control] = [r.id for r in reqs]

        return matrix

    def gap_analysis(
        self,
        requirement_set: RequirementSet,
        framework: ComplianceFramework
    ) -> Dict[str, List[str]]:
        """Identify compliance gaps."""
        gaps = {"missing_controls": [], "weak_coverage": []}
        framework_controls = self.FRAMEWORK_CONTROLS.get(framework, {})

        for domain, controls in framework_controls.items():
            domain_reqs = requirement_set.get_by_domain(domain)
            for control in controls:
                matching = self.get_requirements_for_control(
                    requirement_set, framework, control
                )
                if not matching:
                    gaps["missing_controls"].append(f"{framework.value}:{control}")
                elif len(matching) < 2:
                    gaps["weak_coverage"].append(f"{framework.value}:{control}")

        return gaps
```

### Template 4: Security User Story Generator

```python
class SecurityUserStoryGenerator:
    """Generate security-focused user stories."""

    STORY_TEMPLATES = {
        SecurityDomain.AUTHENTICATION: {
            "as_a": "security-conscious user",
            "so_that": "my identity is protected from impersonation",
        },
        SecurityDomain.AUTHORIZATION: {
            "as_a": "system administrator",
            "so_that": "users can only access resources appropriate to their role",
        },
        SecurityDomain.DATA_PROTECTION: {
            "as_a": "data owner",
            "so_that": "my sensitive information remains confidential",
        },
        SecurityDomain.AUDIT_LOGGING: {
            "as_a": "security analyst",
            "so_that": "I can investigate security incidents",
        },
        SecurityDomain.INPUT_VALIDATION: {
            "as_a": "application developer",
            "so_that": "the system is protected from malicious input",
        },
    }

    def generate_story(self, requirement: SecurityRequirement) -> str:
        """Generate a user story from requirement."""
        template = self.STORY_TEMPLATES.get(
            requirement.domain,
            {"as_a": "user", "so_that": "the system is secure"}
        )

        story = f"""
## {requirement.id}: {requirement.title}

**User Story:**
As a {template['as_a']},
I want the system to {requirement.description.lower()},
So that {template['so_that']}.

**Priority:** {requirement.priority.name}
**Type:** {requirement.req_type.value}
**Domain:** {requirement.domain.value}

**Acceptance Criteria:**
{self._format_acceptance_criteria(requirement.acceptance_criteria)}

**Definition of Done:**
- [ ] Implementation complete
- [ ] Security tests pass
- [ ] Code review complete
- [ ] Security review approved
- [ ] Documentation updated

**Security Test Cases:**
{self._format_test_cases(requirement.test_cases)}

**Traceability:**
- Threats: {', '.join(requirement.threat_refs) or 'N/A'}
- Compliance: {', '.join(requirement.compliance_refs) or 'N/A'}
"""
        return story

    def _format_acceptance_criteria(self, criteria: List[str]) -> str:
        return "\n".join(f"- [ ] {c}" for c in criteria) if criteria else "- [ ] TBD"

    def _format_test_cases(self, tests: List[str]) -> str:
        return "\n".join(f"- {t}" for t in tests) if tests else "- TBD"

    def generate_epic(
        self,
        requirement_set: RequirementSet,
        domain: SecurityDomain
    ) -> str:
        """Generate an epic for a security domain."""
        reqs = requirement_set.get_by_domain(domain)

        epic = f"""
# Security Epic: {domain.value.replace('_', ' ').title()}

## Overview
This epic covers all security requirements related to {domain.value.replace('_', ' ')}.

## Business Value
- Protect against {domain.value.replace('_', ' ')} related threats
- Meet compliance requirements
- Reduce security risk

## Stories in this Epic
{chr(10).join(f'- [{r.id}] {r.title}' for r in reqs)}

## Acceptance Criteria
- All stories complete
- Security tests passing
- Security review approved
- Compliance requirements met

## Risk if Not Implemented
- Vulnerability to {domain.value.replace('_', ' ')} attacks
- Compliance violations
- Potential data breach

## Dependencies
{chr(10).join(f'- {d}' for r in reqs for d in r.dependencies) or '- None identified'}
"""
        return epic
```

## Best Practices

### Do's

- **Trace to threats** - Every requirement should map to threats
- **Be specific** - Vague requirements can't be tested
- **Include acceptance criteria** - Define "done"
- **Consider compliance** - Map to frameworks early
- **Review regularly** - Requirements evolve with threats

### Don'ts

- **Don't be generic** - "Be secure" is not a requirement
- **Don't skip rationale** - Explain why it matters
- **Don't ignore priorities** - Not all requirements are equal
- **Don't forget testability** - If you can't test it, you can't verify it
- **Don't work in isolation** - Involve stakeholders
