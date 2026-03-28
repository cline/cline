# Business Logic Model

## Overview
Unit 5 defines a runtime expansion framework that records the remaining future runtime targets without forcing them into the active runtime registry.

## Main Flow
1. future runtime ids are declared centrally
2. each remaining future runtime gets a descriptor covering stage, execution mode, shim strategy, and capability intent
3. descriptor validation ensures no future runtime id is forgotten during later onboarding
