#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate arena3_conceptual_erd.drawio
Contains two Draw.io pages:
  Page 1: Pure Conceptual ERD (Entities + Relationships + Cardinalities, NO attributes/data types)
  Page 2: Standard Logical ERD (Normalized 3NF, PK/FK, each attribute strictly on its own line)
Adheres strictly to UML 2.0 and eliminates all redundancies & ambiguities.
"""
import xml.etree.ElementTree as ET
from xml.dom import minidom

def build_multipage_drawio():
    mxfile = ET.Element("mxfile", host="app.diagrams.net", version="24.0.0", type="device")

    # =========================================================================
    # PAGE 1: PURE CONCEPTUAL ERD
    # =========================================================================
    diag_conceptual = ET.SubElement(mxfile, "diagram", id="conceptual-erd", name="1. Conceptual ERD")
    model_c = ET.SubElement(
        diag_conceptual, "mxGraphModel",
        dx="1400", dy="950", grid="1", gridSize="10",
        guides="1", tooltips="1", connect="1", arrows="1", fold="1",
        page="1", pageScale="1", pageWidth="1600", pageHeight="1100",
        background="#ffffff"
    )
    root_c = ET.SubElement(model_c, "root")
    ET.SubElement(root_c, "mxCell", id="0")
    ET.SubElement(root_c, "mxCell", id="1", parent="0")

    def add_conceptual_entity(eid, name, x, y, w=170, h=60):
        cell = ET.SubElement(
            root_c, "mxCell",
            id=eid,
            value=f"<b>{name}</b>",
            style=(
                "rounded=0;whiteSpace=wrap;html=1;fontFamily=Helvetica;fontSize=13;"
                "fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;fontColor=#000000;"
            ),
            vertex="1",
            parent="1"
        )
        ET.SubElement(cell, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        return cell

    def add_c_relation(rid, source, target, verb, src_card, trg_card, 
                       is_composition=False, exit_x=None, exit_y=None, entry_x=None, entry_y=None, waypoints=None):
        style_parts = [
            "edgeStyle=orthogonalEdgeStyle",
            "rounded=0",
            "html=1",
            "strokeColor=#000000",
            "strokeWidth=1.5",
            "fontSize=11",
            "fontFamily=Helvetica",
            "fontStyle=2",
            "fontColor=#000000"
        ]
        if is_composition:
            style_parts.extend(["startArrow=diamond", "startFill=1", "startSize=12", "endArrow=none"])
        else:
            style_parts.extend(["startArrow=none", "endArrow=none"])

        if exit_x is not None and exit_y is not None:
            style_parts.append(f"exitX={exit_x};exitY={exit_y};exitDx=0;exitDy=0")
        if entry_x is not None and entry_y is not None:
            style_parts.append(f"entryX={entry_x};entryY={entry_y};entryDx=0;entryDy=0")

        edge = ET.SubElement(
            root_c, "mxCell",
            id=rid,
            value=verb,
            style=";".join(style_parts) + ";",
            edge="1",
            source=source,
            target=target,
            parent="1"
        )
        geom = ET.SubElement(edge, "mxGeometry", relative="1", **{"as": "geometry"})
        if waypoints:
            pts = ET.SubElement(geom, "Array", **{"as": "points"})
            for (px, py) in waypoints:
                ET.SubElement(pts, "mxPoint", x=str(px), y=str(py))

        src_lbl = ET.SubElement(
            root_c, "mxCell",
            id=f"{rid}_src",
            value=src_card,
            style="edgeLabel;html=1;align=left;verticalAlign=bottom;resizable=0;points=[];fontSize=11;fontFamily=Helvetica;fontColor=#000000;fontStyle=1;",
            vertex="1",
            connectable="0",
            parent=rid
        )
        s_g = ET.SubElement(src_lbl, "mxGeometry", x="-0.75", relative="1", **{"as": "geometry"})
        ET.SubElement(s_g, "mxPoint", y="-8", **{"as": "offset"})

        trg_lbl = ET.SubElement(
            root_c, "mxCell",
            id=f"{rid}_trg",
            value=trg_card,
            style="edgeLabel;html=1;align=right;verticalAlign=bottom;resizable=0;points=[];fontSize=11;fontFamily=Helvetica;fontColor=#000000;fontStyle=1;",
            vertex="1",
            connectable="0",
            parent=rid
        )
        t_g = ET.SubElement(trg_lbl, "mxGeometry", x="0.75", relative="1", **{"as": "geometry"})
        ET.SubElement(t_g, "mxPoint", y="-8", **{"as": "offset"})
        return edge

    # Place Entities for Conceptual ERD (Grid layout: 5 columns, 4 rows)
    # Row 1 (y = 80)
    add_conceptual_entity("c_user", "User", 60, 80, 180, 60)
    add_conceptual_entity("c_court", "Court", 380, 80, 180, 60)
    add_conceptual_entity("c_occupancy", "Occupancy", 700, 80, 180, 60)
    add_conceptual_entity("c_class", "Class", 1020, 80, 180, 60)
    add_conceptual_entity("c_enrollment", "Enrollment", 1340, 80, 180, 60)

    # Row 2 (y = 280)
    add_conceptual_entity("c_membership_plan", "MembershipPlan", 60, 280, 180, 60)
    add_conceptual_entity("c_court_booking", "CourtBooking", 380, 280, 180, 60)
    add_conceptual_entity("c_price_rule", "PriceRule", 700, 280, 180, 60)
    add_conceptual_entity("c_session", "Session", 1020, 280, 180, 60)
    add_conceptual_entity("c_attendance", "Attendance", 1340, 280, 180, 60)

    # Row 3 (y = 480)
    add_conceptual_entity("c_subscription", "Subscription", 60, 480, 180, 60)
    add_conceptual_entity("c_cashier_shift", "CashierShift", 380, 480, 180, 60)
    add_conceptual_entity("c_payment", "Payment", 700, 480, 180, 60)
    add_conceptual_entity("c_equipment", "Equipment", 1020, 480, 180, 60)
    add_conceptual_entity("c_equipment_loan", "EquipmentLoan", 1340, 480, 180, 60)

    # Row 4 (y = 680)
    add_conceptual_entity("c_invoice", "Invoice", 700, 680, 180, 60)
    add_conceptual_entity("c_invoice_line", "InvoiceLine", 1020, 680, 180, 60)

    # Conceptual Relationships
    # 1. User -> Subscription
    add_c_relation("crel_user_sub", "c_user", "c_subscription", "subscribes", "1", "0..*", exit_x="0.2", exit_y="1", entry_x="0.2", entry_y="0")

    # 2. MembershipPlan -> Subscription
    add_c_relation("crel_plan_sub", "c_membership_plan", "c_subscription", "defines terms", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 3. User -> CourtBooking
    add_c_relation("crel_user_booking", "c_user", "c_court_booking", "places", "1", "0..*", exit_x="0.8", exit_y="1", entry_x="0.2", entry_y="0")

    # 4. Court -> CourtBooking
    add_c_relation("crel_court_booking", "c_court", "c_court_booking", "reserved in", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 5. Court -> Occupancy (ONLY ONE direct relationship!)
    add_c_relation("crel_court_occ", "c_court", "c_occupancy", "schedules", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 6. CourtBooking -> Occupancy
    add_c_relation("crel_booking_occ", "c_court_booking", "c_occupancy", "locks slot via", "1", "0..1", exit_x="1", exit_y="0.3", entry_x="0.2", entry_y="1")

    # 7. Court -> PriceRule
    add_c_relation("crel_court_price", "c_court", "c_price_rule", "priced by", "0..1", "0..*", exit_x="0.8", exit_y="1", entry_x="0.2", entry_y="0")

    # 8. Court Self-Association: Convertible Pairing (with explicit upward waypoints away from other entities!)
    add_c_relation("crel_court_pair", "c_court", "c_court", "paired with (convertible)", "0..1", "0..1", 
                   exit_x="0.3", exit_y="0", entry_x="0.7", entry_y="0",
                   waypoints=[(434, 40), (506, 40)])

    # 9. Court -> Class (Allocates physical facility to class)
    add_c_relation("crel_court_class", "c_court", "c_class", "hosts", "1", "0..*", exit_x="0.9", exit_y="0", entry_x="0.1", entry_y="0", waypoints=[(542, 20), (1038, 20)])

    # 10. User (Coach) -> Class (Instruction)
    add_c_relation("crel_coach_class", "c_user", "c_class", "coaches", "0..1", "0..*", exit_x="0.5", exit_y="0", entry_x="0.5", entry_y="0", waypoints=[(150, 10), (1110, 10)])

    # 11. Class -> Session (Composition)
    add_c_relation("crel_class_session", "c_class", "c_session", "consists of", "1", "1..*", is_composition=True, exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 12. Session -> Occupancy
    add_c_relation("crel_session_occ", "c_session", "c_occupancy", "locks slot via", "1", "0..1", exit_x="0", exit_y="0.3", entry_x="0.8", entry_y="1")

    # 13. Class -> Enrollment & User -> Enrollment (NO direct User-Class student enrollment link!)
    add_c_relation("crel_class_enroll", "c_class", "c_enrollment", "accepts", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")
    add_c_relation("crel_user_enroll", "c_user", "c_enrollment", "registers", "1", "0..*", exit_x="0.9", exit_y="0", entry_x="0.5", entry_y="0", waypoints=[(222, 50), (1430, 50)])

    # 14. Session -> Attendance & User -> Attendance
    add_c_relation("crel_session_att", "c_session", "c_attendance", "tracks", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")
    add_c_relation("crel_user_att", "c_user", "c_attendance", "recorded in", "1", "0..*", exit_x="1", exit_y="0.8", entry_x="0.5", entry_y="0", waypoints=[(300, 200), (1430, 200)])

    # 15. User (Staff) -> CashierShift
    add_c_relation("crel_user_shift", "c_user", "c_cashier_shift", "manages", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.2", entry_y="0")

    # 16. CashierShift -> Payment
    add_c_relation("crel_shift_pay", "c_cashier_shift", "c_payment", "settles in shift", "0..1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 17. User -> Payment
    add_c_relation("crel_user_pay", "c_user", "c_payment", "makes", "1", "0..*", exit_x="0.6", exit_y="1", entry_x="0.2", entry_y="0", waypoints=[(168, 430), (736, 430)])

    # 18. CourtBooking -> Payment
    add_c_relation("crel_booking_pay", "c_court_booking", "c_payment", "settled by", "0..1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.4", entry_y="0")

    # 19. Subscription -> Payment
    add_c_relation("crel_sub_pay", "c_subscription", "c_payment", "settled by", "0..1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.8")

    # 20. Payment -> Invoice
    add_c_relation("crel_pay_inv", "c_payment", "c_invoice", "issues", "1", "0..1", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 21. Invoice -> InvoiceLine (Composition)
    add_c_relation("crel_inv_lines", "c_invoice", "c_invoice_line", "contains", "1", "1..*", is_composition=True, exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 22. Equipment -> EquipmentLoan
    add_c_relation("crel_eq_loan", "c_equipment", "c_equipment_loan", "loaned in", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 23. User -> EquipmentLoan (Fixed: Direct normalization link!)
    add_c_relation("crel_user_loan", "c_user", "c_equipment_loan", "borrows", "1", "0..*", exit_x="0.9", exit_y="1", entry_x="0.5", entry_y="0", waypoints=[(222, 400), (1430, 400)])

    # 24. CourtBooking -> EquipmentLoan
    add_c_relation("crel_booking_loan", "c_court_booking", "c_equipment_loan", "associated with", "0..1", "0..*", exit_x="1", exit_y="0.8", entry_x="0", entry_y="0.8")


    # =========================================================================
    # PAGE 2: NORMALIZED LOGICAL ERD (Attributes strictly formatted per line)
    # =========================================================================
    diag_logical = ET.SubElement(mxfile, "diagram", id="logical-erd", name="2. Logical ERD")
    model_l = ET.SubElement(
        diag_logical, "mxGraphModel",
        dx="1400", dy="950", grid="1", gridSize="10",
        guides="1", tooltips="1", connect="1", arrows="1", fold="1",
        page="1", pageScale="1", pageWidth="1700", pageHeight="1300",
        background="#ffffff"
    )
    root_l = ET.SubElement(model_l, "root")
    ET.SubElement(root_l, "mxCell", id="0")
    ET.SubElement(root_l, "mxCell", id="1", parent="0")

    def add_logical_entity(eid, title, pk_fields, fk_fields, normal_fields, x, y, w, h):
        container = ET.SubElement(
            root_l, "mxCell",
            id=eid,
            value=f"<b>{title}</b>",
            style=(
                "swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;"
                "horizontal=1;startSize=28;horizontalStack=0;resizeParent=0;resizeParentMax=0;"
                "resizeLast=0;collapsible=0;marginBottom=0;html=1;whiteSpace=wrap;"
                "fillColor=#ffffff;strokeColor=#000000;strokeWidth=1.5;fontFamily=Helvetica;"
                "fontSize=12;fontColor=#000000;"
            ),
            vertex="1",
            parent="1"
        )
        ET.SubElement(container, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})

        lines = []
        for pk in pk_fields:
            lines.append(f"<div style='font-weight:bold;text-decoration:underline;'>+ {pk} : ID [PK]</div>")
        for fk in fk_fields:
            lines.append(f"<div style='font-style:italic;'>+ {fk} [FK]</div>")
        for f in normal_fields:
            lines.append(f"<div>+ {f}</div>")
        content_html = "".join(lines)

        a_cell = ET.SubElement(
            root_l, "mxCell",
            id=f"{eid}_attrs",
            value=content_html,
            style=(
                "text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;"
                "spacingLeft=8;spacingTop=6;spacingRight=6;overflow=hidden;whiteSpace=wrap;"
                "html=1;fontFamily=Helvetica;fontSize=11;fontColor=#000000;lineHeight=1.5;"
            ),
            vertex="1",
            parent=eid
        )
        ET.SubElement(a_cell, "mxGeometry", y="28", width=str(w), height=str(h - 28), **{"as": "geometry"})
        return container

    def add_l_relation(rid, source, target, verb, src_card, trg_card, 
                       is_composition=False, exit_x=None, exit_y=None, entry_x=None, entry_y=None, waypoints=None):
        style_parts = [
            "edgeStyle=orthogonalEdgeStyle",
            "rounded=0",
            "html=1",
            "strokeColor=#000000",
            "strokeWidth=1.5",
            "fontSize=11",
            "fontFamily=Helvetica",
            "fontStyle=2",
            "fontColor=#000000"
        ]
        if is_composition:
            style_parts.extend(["startArrow=diamond", "startFill=1", "startSize=12", "endArrow=none"])
        else:
            style_parts.extend(["startArrow=none", "endArrow=none"])

        if exit_x is not None and exit_y is not None:
            style_parts.append(f"exitX={exit_x};exitY={exit_y};exitDx=0;exitDy=0")
        if entry_x is not None and entry_y is not None:
            style_parts.append(f"entryX={entry_x};entryY={entry_y};entryDx=0;entryDy=0")

        edge = ET.SubElement(
            root_l, "mxCell",
            id=rid,
            value=verb,
            style=";".join(style_parts) + ";",
            edge="1",
            source=source,
            target=target,
            parent="1"
        )
        geom = ET.SubElement(edge, "mxGeometry", relative="1", **{"as": "geometry"})
        if waypoints:
            pts = ET.SubElement(geom, "Array", **{"as": "points"})
            for (px, py) in waypoints:
                ET.SubElement(pts, "mxPoint", x=str(px), y=str(py))

        src_lbl = ET.SubElement(
            root_l, "mxCell",
            id=f"{rid}_src",
            value=src_card,
            style="edgeLabel;html=1;align=left;verticalAlign=bottom;resizable=0;points=[];fontSize=11;fontFamily=Helvetica;fontColor=#000000;fontStyle=1;",
            vertex="1",
            connectable="0",
            parent=rid
        )
        s_g = ET.SubElement(src_lbl, "mxGeometry", x="-0.75", relative="1", **{"as": "geometry"})
        ET.SubElement(s_g, "mxPoint", y="-8", **{"as": "offset"})

        trg_lbl = ET.SubElement(
            root_l, "mxCell",
            id=f"{rid}_trg",
            value=trg_card,
            style="edgeLabel;html=1;align=right;verticalAlign=bottom;resizable=0;points=[];fontSize=11;fontFamily=Helvetica;fontColor=#000000;fontStyle=1;",
            vertex="1",
            connectable="0",
            parent=rid
        )
        t_g = ET.SubElement(trg_lbl, "mxGeometry", x="0.75", relative="1", **{"as": "geometry"})
        ET.SubElement(t_g, "mxPoint", y="-8", **{"as": "offset"})
        return edge

    # Place Entities for Logical ERD
    # Row 1 (y = 80)
    add_logical_entity("l_user", "User", ["userId"], [], [
        "memberCode : String", "fullName : String", "phone : String",
        "email : String", "role : UserRole", "status : UserStatus", "dateOfBirth : Date"
    ], 60, 80, 210, 200)

    add_logical_entity("l_court", "Court", ["courtId"], ["pairCourtId : ID"], [
        "courtCode : String", "sportType : SportKind", "status : CourtStatus", "isConvertible : Boolean"
    ], 390, 80, 210, 160)

    add_logical_entity("l_occupancy", "Occupancy", ["occupancyId"], ["courtId : ID"], [
        "startTime : DateTime", "endTime : DateTime", "occupancyType : OccKind", "reason : String"
    ], 710, 80, 210, 160)

    add_logical_entity("l_class", "Class", ["classId"], ["coachId : ID", "courtId : ID"], [
        "className : String", "sportType : SportKind", "level : String",
        "capacity : Integer", "enrolledCount : Integer", "scheduleRule : String", "startDate : Date"
    ], 1030, 80, 220, 220)

    add_logical_entity("l_enrollment", "Enrollment", ["enrollmentId"], ["classId : ID", "userId : ID"], [
        "enrollDate : Date", "status : EnrollStatus", "waitlistPosition : Integer"
    ], 1360, 80, 210, 150)

    # Row 2 (y = 360)
    add_logical_entity("l_membership_plan", "MembershipPlan", ["planId"], [], [
        "planName : String", "sportScope : SportKind", "durationDays : Integer",
        "courtHours : Integer", "sessionQuota : Integer", "courtDiscountPct : Integer", "price : Money"
    ], 60, 360, 210, 190)

    add_logical_entity("l_court_booking", "CourtBooking", ["bookingId"], ["courtId : ID", "userId : ID", "occupancyId : ID"], [
        "bookingCode : String", "startTime : DateTime", "endTime : DateTime",
        "status : BookingStatus", "channel : BookingChannel", "price : Money"
    ], 390, 340, 220, 210)

    add_logical_entity("l_price_rule", "PriceRule", ["ruleId"], ["courtId : ID"], [
        "sportType : SportKind", "dayType : DayKind", "startTime : Time",
        "endTime : Time", "hourlyRate : Money", "isPeak : Boolean"
    ], 710, 340, 210, 170)

    add_logical_entity("l_session", "Session", ["sessionId"], ["classId : ID", "occupancyId : ID"], [
        "startTime : DateTime", "endTime : DateTime", "status : SessionStatus"
    ], 1030, 360, 220, 150)

    add_logical_entity("l_attendance", "Attendance", ["attendanceId"], ["userId : ID", "sessionId : ID"], [
        "checkInTime : DateTime", "attendanceType : AttendKind", "result : AttendResult"
    ], 1360, 360, 210, 150)

    # Row 3 (y = 630)
    add_logical_entity("l_subscription", "Subscription", ["subscriptionId"], ["userId : ID", "planId : ID"], [
        "sportScope : SportKind", "startDate : Date", "endDate : Date",
        "status : SubStatus", "remainingCourtHours : Decimal", "remainingSessions : Integer"
    ], 60, 630, 210, 190)

    add_logical_entity("l_cashier_shift", "CashierShift", ["shiftId"], ["receptionistId : ID"], [
        "openTime : DateTime", "closeTime : DateTime", "cashDeclared : Money"
    ], 390, 630, 210, 140)

    add_logical_entity("l_payment", "Payment", ["paymentId"], ["userId : ID", "shiftId : ID"], [
        "paymentCode : String", "paymentMethod : PayMethod", "amount : Money",
        "status : PayStatus", "referenceType : String", "paymentDate : DateTime"
    ], 710, 610, 220, 190)

    add_logical_entity("l_equipment", "Equipment", ["equipmentId"], [], [
        "itemCode : String", "itemName : String", "sportType : SportKind",
        "stockQuantity : Integer", "rentalFee : Money"
    ], 1030, 610, 210, 160)

    add_logical_entity("l_equipment_loan", "EquipmentLoan", ["loanId"], ["equipmentId : ID", "userId : ID", "bookingId : ID"], [
        "quantity : Integer", "status : LoanStatus", "dueDate : DateTime", "returnedDate : DateTime"
    ], 1360, 610, 220, 170)

    # Row 4 (y = 880)
    add_logical_entity("l_invoice", "Invoice", ["invoiceId"], ["paymentId : ID"], [
        "invoiceCode : String", "buyerName : String", "buyerTaxCode : String", "issueDate : DateTime"
    ], 710, 880, 220, 150)

    add_logical_entity("l_invoice_line", "InvoiceLine", ["lineId"], ["invoiceId : ID"], [
        "itemDescription : String", "quantity : Integer", "unitPrice : Money", "totalAmount : Money"
    ], 1030, 880, 210, 150)

    # Logical Relationships (Matching clean semantics & no redundancies)
    # 1. User -> Subscription
    add_l_relation("lrel_user_sub", "l_user", "l_subscription", "subscribes", "1", "0..*", exit_x="0.2", exit_y="1", entry_x="0.2", entry_y="0")

    # 2. MembershipPlan -> Subscription
    add_l_relation("lrel_plan_sub", "l_membership_plan", "l_subscription", "defines terms", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 3. User -> CourtBooking
    add_l_relation("lrel_user_booking", "l_user", "l_court_booking", "places", "1", "0..*", exit_x="0.8", exit_y="1", entry_x="0.2", entry_y="0")

    # 4. Court -> CourtBooking
    add_l_relation("lrel_court_booking", "l_court", "l_court_booking", "reserved in", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 5. Court -> Occupancy (ONLY ONE direct relationship!)
    add_l_relation("lrel_court_occ", "l_court", "l_occupancy", "schedules", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 6. CourtBooking -> Occupancy
    add_l_relation("lrel_booking_occ", "l_court_booking", "l_occupancy", "locks slot via", "1", "0..1", exit_x="1", exit_y="0.3", entry_x="0.2", entry_y="1")

    # 7. Court -> PriceRule
    add_l_relation("lrel_court_price", "l_court", "l_price_rule", "priced by", "0..1", "0..*", exit_x="0.8", exit_y="1", entry_x="0.2", entry_y="0")

    # 8. Court Self-Association: Convertible Pairing (with explicit upward waypoints away from other entities!)
    add_l_relation("lrel_court_pair", "l_court", "l_court", "paired with (convertible)", "0..1", "0..1", 
                   exit_x="0.3", exit_y="0", entry_x="0.7", entry_y="0",
                   waypoints=[(453, 40), (537, 40)])

    # 9. Court -> Class (Allocates physical facility to class)
    add_l_relation("lrel_court_class", "l_court", "l_class", "hosts", "1", "0..*", exit_x="0.9", exit_y="0", entry_x="0.1", entry_y="0", waypoints=[(579, 20), (1052, 20)])

    # 10. User (Coach) -> Class (Instruction)
    add_l_relation("lrel_coach_class", "l_user", "l_class", "coaches", "0..1", "0..*", exit_x="0.5", exit_y="0", entry_x="0.5", entry_y="0", waypoints=[(165, 10), (1140, 10)])

    # 11. Class -> Session (Composition)
    add_l_relation("lrel_class_session", "l_class", "l_session", "consists of", "1", "1..*", is_composition=True, exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 12. Session -> Occupancy
    add_l_relation("lrel_session_occ", "l_session", "l_occupancy", "locks slot via", "1", "0..1", exit_x="0", exit_y="0.3", entry_x="0.8", entry_y="1")

    # 13. Class -> Enrollment & User -> Enrollment (NO direct User-Class student enrollment link!)
    add_l_relation("lrel_class_enroll", "l_class", "l_enrollment", "accepts", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")
    add_l_relation("lrel_user_enroll", "l_user", "l_enrollment", "registers", "1", "0..*", exit_x="0.9", exit_y="0", entry_x="0.5", entry_y="0", waypoints=[(249, 50), (1465, 50)])

    # 14. Session -> Attendance & User -> Attendance
    add_l_relation("lrel_session_att", "l_session", "l_attendance", "tracks", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")
    add_l_relation("lrel_user_att", "l_user", "l_attendance", "recorded in", "1", "0..*", exit_x="1", exit_y="0.8", entry_x="0.5", entry_y="0", waypoints=[(320, 240), (1465, 240)])

    # 15. User (Staff) -> CashierShift
    add_l_relation("lrel_user_shift", "l_user", "l_cashier_shift", "manages", "1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.2", entry_y="0")

    # 16. CashierShift -> Payment
    add_l_relation("lrel_shift_pay", "l_cashier_shift", "l_payment", "settles in shift", "0..1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 17. User -> Payment
    add_l_relation("lrel_user_pay", "l_user", "l_payment", "makes", "1", "0..*", exit_x="0.6", exit_y="1", entry_x="0.2", entry_y="0", waypoints=[(186, 520), (754, 520)])

    # 18. CourtBooking -> Payment
    add_l_relation("lrel_booking_pay", "l_court_booking", "l_payment", "settled by", "0..1", "0..*", exit_x="0.5", exit_y="1", entry_x="0.4", entry_y="0")

    # 19. Subscription -> Payment
    add_l_relation("lrel_sub_pay", "l_subscription", "l_payment", "settled by", "0..1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.8")

    # 20. Payment -> Invoice
    add_l_relation("lrel_pay_inv", "l_payment", "l_invoice", "issues", "1", "0..1", exit_x="0.5", exit_y="1", entry_x="0.5", entry_y="0")

    # 21. Invoice -> InvoiceLine (Composition)
    add_l_relation("lrel_inv_lines", "l_invoice", "l_invoice_line", "contains", "1", "1..*", is_composition=True, exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 22. Equipment -> EquipmentLoan
    add_l_relation("lrel_eq_loan", "l_equipment", "l_equipment_loan", "loaned in", "1", "0..*", exit_x="1", exit_y="0.5", entry_x="0", entry_y="0.5")

    # 23. User -> EquipmentLoan (Fixed: Direct normalization link!)
    add_l_relation("lrel_user_loan", "l_user", "l_equipment_loan", "borrows", "1", "0..*", exit_x="0.9", exit_y="1", entry_x="0.5", entry_y="0", waypoints=[(249, 440), (1470, 440)])

    # 24. CourtBooking -> EquipmentLoan
    add_l_relation("lrel_booking_loan", "l_court_booking", "l_equipment_loan", "associated with", "0..1", "0..*", exit_x="1", exit_y="0.8", entry_x="0", entry_y="0.8")

    return mxfile

def main():
    root_elem = build_multipage_drawio()
    xml_str = ET.tostring(root_elem, encoding="utf-8")
    reparsed = minidom.parseString(xml_str)
    pretty_xml = reparsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")
    
    target_path = "d:/FPTU/tai-lieu-FPTU/SWP391/SportsCenterProject_Clone/Arena3/arena3_conceptual_erd.drawio"
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(pretty_xml)
    print(f"Generated multi-page Draw.io ERD to {target_path}")

if __name__ == "__main__":
    main()
