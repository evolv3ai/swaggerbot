> **Superseded (2026-09-22).** This document describes the original May 2025 design and is kept for history only. The current domain language is in [`CONTEXT.md`](../CONTEXT.md), decisions are in [`docs/adr/`](adr/), and requirements are in [`docs/PRD.md`](PRD.md).

# Project Brief: swagger.bot

## Introduction / Problem Statement

swagger.bot addresses a critical challenge in the API ecosystem: the difficulty in discovering and retrieving publicly available OpenAPI (Swagger) specification files for applications and APIs. While OpenAPI/Swagger is the most widely supported format for API specifications according to 2024 studies, finding these specs often requires manual hunting across various sources. swagger.bot streamlines this discovery process by automatically searching the public web for specification files when given the name of an app, service, or developer API.

This tool fills an important gap in the API integration workflow. Unlike static databases of API specs (such as APIs.guru's OpenAPI Directory), swagger.bot actively searches the live web for specification files on-demand, casting a wide net across the public internet to discover openly published API definitions. By quickly finding OpenAPI definitions for disparate services, swagger.bot supports the larger vision of unified API access across domains.

## Vision & Goals

- **Vision:** To enable seamless API discovery and integration by creating a reliable, intelligent tool that automatically finds and processes OpenAPI specifications, transforming them into immediately useful resources for developers and integrators.

- **Primary Goals:**

  - Goal 1: Develop a robust, multi-strategy search system that can reliably discover OpenAPI/Swagger specification files for a given API or service name.
  - Goal 2: Create an AI-enhanced processing pipeline that can parse, validate, and enrich discovered API specifications with human-readable summaries and insights.
  - Goal 3: Implement a flexible response system that can deliver results in various formats (raw specs, summaries, interactive analysis) based on user needs.
  - Goal 4: Build a modular, maintainable architecture using LangGraph JS for orchestrating the discovery, enrichment, and response workflow.

- **Success Metrics (Initial Ideas):**
  - Percentage of successful spec discoveries for known APIs (target: >80%)
  - Accuracy of AI-generated summaries compared to manual summaries (target: >90% information retention)
  - Average time to discover and process a specification (target: <30 seconds)
  - User satisfaction with the quality and usefulness of results (measured through feedback)

## Target Audience / Users

The primary users of swagger.bot are:

1. **API Integrators & Developers:** Professionals who need to quickly understand and integrate with third-party APIs without spending time manually hunting for documentation.

2. **Technical Product Managers:** Individuals evaluating potential API integrations who need quick insights into an API's capabilities without deep technical investigation.

3. **API Platform Teams:** Teams building unified API platforms (like Unified.to) who need to efficiently discover and process API specifications for multiple services.

4. **Documentation Teams:** Professionals responsible for maintaining API documentation who need to verify or reference official specifications.

## Key Features / Scope (High-Level Ideas for MVP)

- Feature Idea 1: **Multi-Strategy API Spec Discovery Engine** - Implements various search techniques including web search queries, common path probing, and directory lookups to find OpenAPI/Swagger files.

- Feature Idea 2: **Spec Validation & Parsing System** - Fetches discovered specs and validates them against OpenAPI/Swagger standards, handling both JSON and YAML formats.

- Feature Idea 3: **AI-Powered Spec Summarization** - Uses LLMs (like GPT-4 or Claude) to generate concise, human-readable summaries of API capabilities, endpoints, and requirements.

- Feature Idea 4: **LangGraph Orchestration Framework** - Implements a directed workflow using LangGraph JS to manage the discovery→enrichment→response pipeline with proper error handling and decision points.

- Feature Idea 5: **Flexible Response Formatting** - Provides results in multiple formats including raw spec files, markdown summaries, or structured JSON.

## Post MVP Features / Scope and Ideas

- Feature Idea 1: **Interactive API Q&A** - Allow users to ask specific questions about discovered APIs, with the system providing answers based on the spec content.

- Feature Idea 2: **API Comparison Tool** - Compare multiple API specs to highlight similarities, differences, and unique features.

- Feature Idea 3: **Unified.to Integration** - Deeper integration with Unified.to SDK to automatically map discovered APIs to unified schemas.

- Feature Idea 4: **Spec Enhancement** - Use AI to suggest improvements or fill gaps in incomplete API specifications.

- Feature Idea 5: **Historical Versioning** - Track changes in API specs over time by periodically re-checking known sources.

- Feature Idea 6: **Custom Gradio Web Interface** - Develop a more sophisticated web UI beyond the basic demo, with additional visualization and interaction features.

## Known Technical Constraints or Preferences

- **Constraints:**

  - Must be implemented in TypeScript for maintainability and type safety
  - Should handle both OpenAPI v3 and Swagger v2 specifications
  - Must respect rate limits and robots.txt when crawling websites
  - Should work with reasonable performance on standard hardware

- **Initial Architectural Preferences:**

  - Modular architecture with clear separation of concerns (discovery, fetching, enrichment, output)
  - LangGraph JS as the orchestration framework
  - Potential integration with LangChain components where beneficial
  - Flexible AI backend support (OpenAI, Anthropic, etc.)

- **Risks:**

  - Dependency on third-party search APIs which may have rate limits or cost implications
  - Variability in how APIs publish their specifications (non-standard locations)
  - LLM costs for AI-powered summarization and analysis
  - Potential for false positives in spec discovery

- **User Preferences:**
  - Support for both programmatic (API) and interactive (UI) usage
  - Clear documentation of the discovery process and confidence levels
  - Transparency about AI-generated vs. directly extracted information

## Relevant Research

The project builds on existing knowledge about OpenAPI/Swagger specifications, their prevalence across domains, and the challenges in discovering them. It leverages advances in LLM capabilities for processing structured data like API specs, and orchestration frameworks like LangGraph for creating reliable AI workflows.

Key insights from the existing project overview include:

- OpenAPI (formerly Swagger) is the most widely supported format for API specifications according to 2024 studies
- Many services already publish these specs but finding them isn't always straightforward
- A standardized approach to API specs enables unified access across different domains
- LangGraph provides a structured framework for orchestrating complex AI workflows

## PM Prompt

This Project Brief provides the full context for swagger.bot. Please start in 'PRD Generation Mode', review the brief thoroughly to work with the user to create the PRD section by section 1 at a time, asking for any necessary clarification or suggesting improvements as your mode 1 programming allows.
