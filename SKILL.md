---
name: uml-drawio
description: >-
  Use this skill to design, generate, validate, and troubleshoot UML 2.0 diagrams in Draw.io (diagrams.net).
  Covers all 13 standard UML 2.0 diagrams extracted from O'Reilly's 'Learning UML 2.0' (Russ Miles & Kim Hamilton):
  Use Case, Activity, Class, Object, Sequence, Communication, Timing, Interaction Overview, Composite Structure,
  Component, Package, State Machine, and Deployment diagrams. Provides native Draw.io XML snippets, styles, rules,
  and PlantUML/Mermaid alternatives.
---

# UML 2.0 & Draw.io Diagramming Skill

This skill is a complete engineering reference and procedural guide for creating standard **UML 2.0 diagrams** inside **Draw.io (diagrams.net)**, directly derived and synthesized from the definitive reference book:
**"Learning UML 2.0"** by *Russ Miles & Kim Hamilton (O'Reilly Media)*.

---

## 1. UML 2.0 Taxonomy & Classification

UML 2.0 defines 13 official diagrams split into two major branches: **Structure** and **Behavior** (with **Interaction** as a specialized sub-branch of Behavior).

```
                      ┌─────────────────────────┐
                      │    UML 2.0 Diagrams     │
                      └────────────┬────────────┘
            ┌──────────────────────┴──────────────────────┐
            ▼                                             ▼
  ┌───────────────────┐                         ┌───────────────────┐
  │Structure Diagrams │                         │ Behavior Diagrams │
  └─────────┬─────────┘                         └─────────┬─────────┘
            │                                             │
    ├─ Class Diagram                              ├─ Use Case Diagram
    ├─ Object Diagram                             ├─ Activity Diagram
    ├─ Component Diagram                          ├─ State Machine Diagram
    ├─ Composite Structure                                │
    ├─ Package Diagram                                    ▼
    └─ Deployment Diagram                       ┌───────────────────┐
                                                │Interaction Sub-Set│
                                                └─────────┬─────────┘
                                                          │
                                                  ├─ Sequence Diagram
                                                  ├─ Communication Diagram
                                                  ├─ Timing Diagram
                                                  └─ Interaction Overview
```

---

## 2. Decision Matrix: Which Diagram Should You Use?

| Goal / Engineering Question | Recommended Diagram | Focus & Perspective | Reference Guide |
| :--- | :--- | :--- | :--- |
| *What value does the system deliver to external users?* | **Use Case Diagram** | Black-box requirements & actor goals | [01-use-case-diagram.md](./references/01-use-case-diagram.md) |
| *What is the sequential business process or algorithm flow?* | **Activity Diagram** | Token-flow, decisions, swimlanes | [02-activity-diagram.md](./references/02-activity-diagram.md) |
| *What are the static object types, fields, methods, & relations?* | **Class Diagram** | Static structure & data model | [03-class-diagram.md](./references/03-class-diagram.md) |
| *What does the concrete runtime object graph look like right now?* | **Object Diagram** | Runtime snapshot & test scenario | [04-object-diagram.md](./references/04-object-diagram.md) |
| *In what exact order do participants exchange messages over time?* | **Sequence Diagram** | Time-ordered call stacks & lifelines | [05-sequence-diagram.md](./references/05-sequence-diagram.md) |
| *How do collaborating objects link together across a network?* | **Communication Diagram** | Topology with numbered calls | [06-communication-diagram.md](./references/06-communication-diagram.md) |
| *How do participant states change with exact millisecond timings?*| **Timing Diagram** | Latency, state waveforms & constraints | [07-timing-diagram.md](./references/07-timing-diagram.md) |
| *How do multiple sequence scenarios orchestrate together?* | **Interaction Overview** | High-level sequence orchestration | [08-interaction-overview-diagram.md](./references/08-interaction-overview-diagram.md) |
| *What is the internal anatomy, ports, and parts of a complex class?*| **Composite Structure** | Internal decomposition & ports | [09-composite-structure-diagram.md](./references/09-composite-structure-diagram.md) |
| *How are replaceable modular components wired via interfaces?*| **Component Diagram** | Ball & socket interface contracts | [10-component-diagram.md](./references/10-component-diagram.md) |
| *How is the codebase partitioned into layers and namespaces?* | **Package Diagram** | Modules, acyclic dependencies | [11-package-diagram.md](./references/11-package-diagram.md) |
| *What states does a single entity transition through over its life?*| **State Machine Diagram**| Events, guards, state lifecycle | [12-state-machine-diagram.md](./references/12-state-machine-diagram.md) |
| *Where are software artifacts physically deployed on hardware/VMs?*| **Deployment Diagram** | Nodes, servers, networks & artifacts | [13-deployment-diagram.md](./references/13-deployment-diagram.md) |
| *How do we specify formal invariant rules or custom stereotypes?* | **OCL & Profiles** | Formal constraints & extensions | [14-ocl-and-profiles.md](./references/14-ocl-and-profiles.md) |

---

## 3. Draw.io Aesthetics & Visual Style System

To produce clear, professional, and visually engaging diagrams in Draw.io, adhere to these curated design tokens:

### 3.1 Curated Color Palette
- **Primary / User Entities (Soft Slate Blue)**: `fillColor=#dae8fc;strokeColor=#6c8ebf;`
- **Core Processing / Success (Sage Green)**: `fillColor=#d5e8d4;strokeColor=#82b366;`
- **Data / Storage (Warm Amber)**: `fillColor=#fff2cc;strokeColor=#d6b656;`
- **Subsystem / Specialization (Lavender)**: `fillColor=#e1d5e7;strokeColor=#9673a6;`
- **Error / High Alert (Soft Rose)**: `fillColor=#f8cecc;strokeColor=#b85450;`
- **Background Swimlanes / Nodes (Off-white Neutral)**: `fillColor=#f8f9fa;strokeColor=#666666;`

### 3.2 Typography & Geometry Standards
- **Font**: Set `fontFamily=Helvetica` or `fontFamily=Arial` (built into Draw.io).
- **Line Width**: Core boundaries and classes use `strokeWidth=1.5`. Auxiliary lines use `strokeWidth=1`.
- **Connector Routing**: Use `edgeStyle=orthogonalEdgeStyle;rounded=0;` for crisp 90-degree elbows. Avoid diagonal crisscrossing edges.
- **Grid Alignment**: Always snap coordinates to a **10px grid** (`gridSize=10`).

### 3.3 ERD & Data Modeling Standards (Conceptual vs Logical vs Physical)

When modeling databases using UML or Crow's Foot ERD, you must strictly respect the boundary between modeling levels:

#### 1. Three Distinct Levels of Data Modeling:
- **Conceptual ERD (Mức ý niệm / quan niệm)**:
  - **Core Intent**: High-level domain understanding for business stakeholders.
  - **Elements**: Contains **ONLY Entity Names** and **Relationships** with Cardinalities (`1..1`, `1..*`, `0..1`, `0..*`).
  - **STRICT RULE**: **NO attributes, NO data types, and NO PK/FK notation**. Represent each entity as a single-compartment rectangle (`rounded=0;whiteSpace=wrap;html=1;fontStyle=1;`).
- **Logical ERD (Mức logic)**:
  - **Core Intent**: Normalized, database-agnostic structural schema (typically 3NF).
  - **Elements**: Entities with full business attributes, explicitly labeled Primary Keys (`[PK]`), Foreign Keys (`[FK]`), and business types (`ID`, `String`, `Date`, `DateTime`, `Money`, `Integer`, `Boolean`, `Enum`).
  - **STRICT RULE**: All Many-to-Many ($M:N$) relationships must be fully resolved into **Associative Entities** (e.g. `Enrollment` between `User` and `Class`).
  - **Formatting Rule**: **Every attribute MUST be rendered on its own independent line** using `<div>+ attrName : Type</div>` or individual table rows. Never lump attributes into a single run-on text paragraph.
- **Physical ERD (Mức vật lý)**:
  - **Core Intent**: Direct implementation blueprint for a specific RDBMS (e.g., PostgreSQL 16, MySQL, Oracle).
  - **Elements**: Exact engine-specific types (`UUID`, `VARCHAR(120)`, `TIMESTAMPTZ`, `INT4`, `JSONB`), indexes, nullability constraints (`NOT NULL`), default values, trigger references, and partition keys.

#### 2. Critical ERD Modeling Rules & Anti-Patterns to Avoid:
- **Anti-Pattern 1: Structural Redundancy (Dư thừa quan hệ)**:
  - When an Associative Entity (e.g., `Enrollment`) exists to bridge Entity A (`User`) and Entity B (`Class`), you **MUST REMOVE any direct $N:N$ relationship** (e.g., `enrolls in`) between A and B. Keeping both violates normal form and creates ambiguous data paths.
- **Anti-Pattern 2: Multi-line & Ambiguous Crossing (Quan hệ đa tuyến chồng chéo)**:
  - Between any two entities, maintain only distinct, semantically necessary relationships.
  - Never allow orthogonal routing lines to cross through unrelated entity boxes. If two entities share a direct relationship, route it cleanly without overlapping neighboring entities.
- **Anti-Pattern 3: Orphan Text Identifiers (Vi phạm chuẩn hóa / Mất toàn vẹn tham chiếu)**:
  - Never store a foreign identity as an untracked string attribute (e.g., storing `borrowerPhone : String` inside `EquipmentLoan` without a foreign key).
  - Always model a direct association from the parent entity (`User` ── `EquipmentLoan`), ensuring relational integrity.
- **Anti-Pattern 4: Ambiguous Self-Associations (Ngữ nghĩa vòng tự thân mơ hồ)**:
  - For self-referencing relationships (e.g. `Court` paired with `Court` for convertible sports facilities), provide explicit directional waypoints that loop cleanly outside the entity boundary so it is never confused with an association to a neighboring entity.
- **Style Standard (Monochrome / B&W)**:
  - For formal academic or engineering reviews, use pure Black & White (`fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;fontColor=#000000;`).
  - Do not add outer background boxes, colored modules, or lengthy descriptive paragraphs onto the diagram canvas itself.

---

## 4. Draw.io XML Core Schema

Draw.io files (`.drawio` or `.xml`) are built on the `mxGraphModel` format:
```xml
<mxfile host="app.diagrams.net" version="24.0.0" type="device">
  <diagram id="diagram_id" name="Page-1">
    <mxGraphModel dx="1000" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" background="#ffffff">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- Shape Cell (Vertex) -->
        <mxCell id="node_id" value="Label Text" style="[style_tokens]" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
        </mxCell>
        <!-- Connector Cell (Edge) -->
        <mxCell id="edge_id" value="Edge Label" style="[style_tokens]" edge="1" source="source_id" target="target_id" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

---

## 5. Workflow: How to Draw & Use Diagrams in Draw.io

### Approach A: Native `.drawio` File Generation (Recommended)
1. Pick the template from the [`templates/`](./templates/) folder (e.g. `01_use_case_diagram.drawio`).
2. Customize the vertices, labels, and connections according to your domain model.
3. Open directly in Draw.io Desktop, or drag & drop into [app.diagrams.net](https://app.diagrams.net), or open via VS Code Draw.io extension.

### Approach B: Draw.io In-App Import via XML
1. Open Draw.io.
2. Navigate to **Arrange** -> **Insert** -> **Advanced** -> **XML** (or press `Ctrl+Shift+X` / `Extras -> Edit Diagram`).
3. Paste the `<mxfile>...</mxfile>` snippet from the reference guides.
4. Click **Insert** / **Apply**.

### Approach C: Quick Text Generation (PlantUML / Mermaid)
1. In Draw.io, navigate to **Arrange** -> **Insert** -> **Advanced** -> **PlantUML** (or **Mermaid**).
2. Paste the declarative text snippet provided in each reference guide.
3. Draw.io automatically renders the shapes on your canvas.

---

## 6. Directory Map & Quick Links

- **Reference Documentation (Learning UML 2.0)**:
  - [01. Use Case Diagrams](./references/01-use-case-diagram.md)
  - [02. Activity Diagrams](./references/02-activity-diagram.md)
  - [03. Class Diagrams](./references/03-class-diagram.md)
  - [04. Object Diagrams](./references/04-object-diagram.md)
  - [05. Sequence Diagrams](./references/05-sequence-diagram.md)
  - [06. Communication Diagrams](./references/06-communication-diagram.md)
  - [07. Timing Diagrams](./references/07-timing-diagram.md)
  - [08. Interaction Overview Diagrams](./references/08-interaction-overview-diagram.md)
  - [09. Composite Structure Diagrams](./references/09-composite-structure-diagram.md)
  - [10. Component Diagrams](./references/10-component-diagram.md)
  - [11. Package Diagrams](./references/11-package-diagram.md)
  - [12. State Machine Diagrams](./references/12-state-machine-diagram.md)
  - [13. Deployment Diagrams](./references/13-deployment-diagram.md)
  - [14. OCL and Profiles](./references/14-ocl-and-profiles.md)

- **Ready-to-Use Draw.io Templates**:
  - [`templates/01_use_case_diagram.drawio`](./templates/01_use_case_diagram.drawio)
  - [`templates/02_activity_diagram.drawio`](./templates/02_activity_diagram.drawio)
  - [`templates/03_class_diagram.drawio`](./templates/03_class_diagram.drawio)
  - [`templates/04_object_diagram.drawio`](./templates/04_object_diagram.drawio)
  - [`templates/05_sequence_diagram.drawio`](./templates/05_sequence_diagram.drawio)
  - [`templates/06_communication_diagram.drawio`](./templates/06_communication_diagram.drawio)
  - [`templates/07_timing_diagram.drawio`](./templates/07_timing_diagram.drawio)
  - [`templates/08_interaction_overview_diagram.drawio`](./templates/08_interaction_overview_diagram.drawio)
  - [`templates/09_composite_structure_diagram.drawio`](./templates/09_composite_structure_diagram.drawio)
  - [`templates/10_component_diagram.drawio`](./templates/10_component_diagram.drawio)
  - [`templates/11_package_diagram.drawio`](./templates/11_package_diagram.drawio)
  - [`templates/12_state_machine_diagram.drawio`](./templates/12_state_machine_diagram.drawio)
  - [`templates/13_deployment_diagram.drawio`](./templates/13_deployment_diagram.drawio)

- **Helper Scripts**:
  - Validator: [`scripts/drawio_validator.py`](./scripts/drawio_validator.py)