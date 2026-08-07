from __future__ import annotations

import os
import json
import sys
from pathlib import Path

try:
    from PySide6.QtCore import QPointF, QRectF, Qt, Signal
    from PySide6.QtGui import QAction, QBrush, QColor, QFont, QPainter, QPainterPath, QPen, QTextCursor
    from PySide6.QtWidgets import (
        QApplication,
        QComboBox,
        QFormLayout,
        QFrame,
        QGraphicsItem,
        QGraphicsPathItem,
        QGraphicsRectItem,
        QGraphicsScene,
        QGraphicsTextItem,
        QGraphicsView,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QListWidget,
        QListWidgetItem,
        QMainWindow,
        QMessageBox,
        QPlainTextEdit,
        QPushButton,
        QSizePolicy,
        QSplitter,
        QTabWidget,
        QTextEdit,
        QToolBar,
        QVBoxLayout,
        QWidget,
    )
    from PySide6.QtCore import QProcess
except ModuleNotFoundError:
    print("PySide6 n'est pas installe.")
    print("Installer: python -m pip install -r workflow_app\\requirements-qt.txt")
    raise SystemExit(1)

from graph_store import (
    NODE_WORKFLOWS_PATH,
    NODES_PATH,
    ORCHESTRATOR_ROOT,
    ensure_graph_store,
    executor_for_type,
    load_nodes_store,
    load_workflows_store,
    mode_for_type,
    new_id,
    normalize_node,
    save_nodes_store,
    save_workflows_store,
)


NODE_TYPES = ["script", "condition", "validation", "mistral", "qwen", "note"]
MODES = ["dry-run", "proposal-only", "approval-gate", "manual"]
EXECUTORS = ["script", "codex", "mistral-api", "alibaba-api"]

NODE_COLORS = {
    "script": ("#eff6ff", "#2563eb"),
    "condition": ("#fff7ed", "#f97316"),
    "validation": ("#fef2f2", "#dc2626"),
    "mistral": ("#f5f3ff", "#7c3aed"),
    "qwen": ("#ecfeff", "#0891b2"),
    "note": ("#f8fafc", "#64748b"),
}


def read_field(widget: QLineEdit | QTextEdit | QPlainTextEdit) -> str:
    if isinstance(widget, QLineEdit):
        return widget.text().strip()
    return widget.toPlainText().strip()


def split_ports(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class GridScene(QGraphicsScene):
    def __init__(self, editor: "WorkflowEditor | None" = None) -> None:
        super().__init__()
        self.editor = editor
        self.connect_source: NodeItem | None = None
        self.temp_edge: QGraphicsPathItem | None = None

    def drawBackground(self, painter: QPainter, rect: QRectF) -> None:
        super().drawBackground(painter, rect)
        painter.fillRect(rect, QColor("#f8fafc"))
        grid = 32
        left = int(rect.left()) - (int(rect.left()) % grid)
        top = int(rect.top()) - (int(rect.top()) % grid)
        fine_pen = QPen(QColor("#e2e8f0"), 1)
        major_pen = QPen(QColor("#cbd5e1"), 1)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        x = left
        while x < rect.right():
            painter.setPen(major_pen if x % (grid * 4) == 0 else fine_pen)
            painter.drawLine(x, rect.top(), x, rect.bottom())
            x += grid
        y = top
        while y < rect.bottom():
            painter.setPen(major_pen if y % (grid * 4) == 0 else fine_pen)
            painter.drawLine(rect.left(), y, rect.right(), y)
            y += grid

    def mousePressEvent(self, event) -> None:
        item = self.node_at(event.scenePos())
        if event.button() == Qt.MouseButton.LeftButton and item and item.is_output_hit(event.scenePos()):
            self.connect_source = item
            self.temp_edge = QGraphicsPathItem()
            pen = QPen(QColor("#2563eb"), 2, Qt.PenStyle.DashLine)
            self.temp_edge.setPen(pen)
            self.temp_edge.setZValue(-5)
            self.addItem(self.temp_edge)
            self.update_temp_edge(event.scenePos())
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self.connect_source and self.temp_edge:
            self.update_temp_edge(event.scenePos())
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        if self.connect_source and self.temp_edge:
            target = self.node_at(event.scenePos())
            if target and target is not self.connect_source and target.is_input_hit(event.scenePos()) and self.editor:
                self.editor.add_edge(self.connect_source, target)
            self.removeItem(self.temp_edge)
            self.temp_edge = None
            self.connect_source = None
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def update_temp_edge(self, end: QPointF) -> None:
        if not self.connect_source or not self.temp_edge:
            return
        start = self.connect_source.output_port_scene_pos()
        dx = max(90.0, abs(end.x() - start.x()) * 0.5)
        path = QPainterPath(start)
        path.cubicTo(QPointF(start.x() + dx, start.y()), QPointF(end.x() - dx, end.y()), end)
        self.temp_edge.setPath(path)

    def node_at(self, pos: QPointF) -> "NodeItem | None":
        for item in self.items(pos):
            current = item
            while current:
                if isinstance(current, NodeItem):
                    return current
                current = current.parentItem()
        return None


class GraphView(QGraphicsView):
    def __init__(self, scene: QGraphicsScene) -> None:
        super().__init__(scene)
        self.zoom_level = 1.0

    def wheelEvent(self, event) -> None:
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
            self.zoom_by(factor)
            event.accept()
            return
        super().wheelEvent(event)

    def zoom_by(self, factor: float) -> None:
        self.zoom_level = max(0.35, min(2.4, self.zoom_level * factor))
        self.resetTransform()
        self.scale(self.zoom_level, self.zoom_level)

    def reset_zoom(self) -> None:
        self.zoom_level = 1.0
        self.resetTransform()


class EdgeItem(QGraphicsPathItem):
    def __init__(self, source: "NodeItem", target: "NodeItem") -> None:
        super().__init__()
        self.source = source
        self.target = target
        self.setZValue(-10)
        self.setPen(QPen(QColor("#475569"), 2))
        source.edges.append(self)
        target.edges.append(self)
        self.update_path()

    def update_path(self) -> None:
        start = self.source.output_port_scene_pos()
        end = self.target.input_port_scene_pos()
        dx = max(90.0, abs(end.x() - start.x()) * 0.5)
        path = QPainterPath(start)
        path.cubicTo(QPointF(start.x() + dx, start.y()), QPointF(end.x() - dx, end.y()), end)
        self.setPath(path)

    def detach(self) -> None:
        if self in self.source.edges:
            self.source.edges.remove(self)
        if self in self.target.edges:
            self.target.edges.remove(self)


class NodeItem(QGraphicsRectItem):
    WIDTH = 230
    HEIGHT = 104

    def __init__(self, instance: dict, definition: dict) -> None:
        super().__init__(0, 0, self.WIDTH, self.HEIGHT)
        self.instance = instance
        self.definition = definition
        self.edges: list[EdgeItem] = []
        self.state = "idle"
        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)
        self.setRadiusStyle()
        self.title_item = QGraphicsTextItem(self)
        self.meta_item = QGraphicsTextItem(self)
        self.command_item = QGraphicsTextItem(self)
        self.title_item.setPos(14, 10)
        self.meta_item.setPos(14, 42)
        self.command_item.setPos(14, 68)
        for item in (self.title_item, self.meta_item, self.command_item):
            item.setTextWidth(self.WIDTH - 28)
        self.update_text()

    def setRadiusStyle(self) -> None:
        node_type = self.definition.get("type", "script")
        fill, border = NODE_COLORS.get(node_type, NODE_COLORS["note"])
        if self.state == "running":
            border = "#f97316"
        elif self.state == "ok":
            border = "#16a34a"
        elif self.state == "error":
            border = "#dc2626"
        self.setBrush(QBrush(QColor(fill)))
        self.setPen(QPen(QColor(border), 2))

    def set_state(self, state: str) -> None:
        self.state = state
        self.setRadiusStyle()

    def update_text(self) -> None:
        label = self.instance.get("label") or self.definition.get("name", "Noeud")
        node_type = self.definition.get("type", "script")
        mode = self.instance.get("mode") or self.definition.get("mode", "")
        command = self.instance.get("command") or self.definition.get("command") or self.definition.get("description", "")
        title_font = QFont("Segoe UI", 10)
        title_font.setBold(True)
        meta_font = QFont("Consolas", 8)
        self.title_item.setFont(title_font)
        self.meta_item.setFont(meta_font)
        self.command_item.setFont(QFont("Segoe UI", 8))
        self.title_item.setDefaultTextColor(QColor("#0f172a"))
        self.meta_item.setDefaultTextColor(QColor("#475569"))
        self.command_item.setDefaultTextColor(QColor("#334155"))
        self.title_item.setPlainText(label)
        self.meta_item.setPlainText(f"{node_type} | {mode}")
        self.command_item.setPlainText(command[:92])
        self.setToolTip(self.definition.get("description", ""))

    def input_port_scene_pos(self) -> QPointF:
        return self.mapToScene(QPointF(0, self.HEIGHT / 2))

    def output_port_scene_pos(self) -> QPointF:
        return self.mapToScene(QPointF(self.WIDTH, self.HEIGHT / 2))

    def is_input_hit(self, scene_pos: QPointF) -> bool:
        return self.distance(scene_pos, self.input_port_scene_pos()) <= 13

    def is_output_hit(self, scene_pos: QPointF) -> bool:
        return self.distance(scene_pos, self.output_port_scene_pos()) <= 13

    def distance(self, a: QPointF, b: QPointF) -> float:
        return ((a.x() - b.x()) ** 2 + (a.y() - b.y()) ** 2) ** 0.5

    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            for edge in list(self.edges):
                edge.update_path()
        return super().itemChange(change, value)

    def paint(self, painter: QPainter, option, widget=None) -> None:
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        rect = self.rect()
        node_type = self.definition.get("type", "script")
        fill, border = NODE_COLORS.get(node_type, NODE_COLORS["note"])
        if self.state == "running":
            border = "#f97316"
        elif self.state == "ok":
            border = "#16a34a"
        elif self.state == "error":
            border = "#dc2626"
        if self.isSelected():
            border = "#0f172a"
        painter.setBrush(QColor(fill))
        painter.setPen(QPen(QColor(border), 2.2))
        painter.drawRoundedRect(rect, 10, 10)
        painter.setBrush(QColor("#ffffff"))
        painter.setPen(QPen(QColor(border), 2))
        painter.drawEllipse(QPointF(0, self.HEIGHT / 2), 7, 7)
        painter.drawEllipse(QPointF(self.WIDTH, self.HEIGHT / 2), 7, 7)


class NodeEditor(QWidget):
    nodes_changed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.store = load_nodes_store()
        self.current_id = ""
        self.ai_process: QProcess | None = None
        self.build_ui()
        self.reload_list()

    def build_ui(self) -> None:
        layout = QHBoxLayout(self)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(splitter)

        left = QFrame()
        left.setObjectName("Panel")
        left_layout = QVBoxLayout(left)
        left_layout.addWidget(QLabel("Bibliotheque de noeuds"))
        self.node_list = QListWidget()
        self.node_list.currentItemChanged.connect(self.on_node_selected)
        left_layout.addWidget(self.node_list)
        row = QHBoxLayout()
        for text, slot in [
            ("Nouveau", self.new_node),
            ("Dupliquer", self.duplicate_node),
            ("Retirer", self.delete_node),
        ]:
            button = QPushButton(text)
            button.clicked.connect(slot)
            row.addWidget(button)
        left_layout.addLayout(row)
        creator = QFrame()
        creator.setObjectName("SubPanel")
        creator_layout = QVBoxLayout(creator)
        creator_layout.addWidget(QLabel("Createur IA securise"))
        self.ai_engine_combo = QComboBox()
        self.ai_engine_combo.addItems(["Mistral", "Qwen", "Local securise"])
        self.ai_goal_field = QTextEdit()
        self.ai_goal_field.setPlaceholderText("Ex: cree un noeud qui verifie les projets sans Git")
        self.ai_goal_field.setFixedHeight(82)
        self.ai_risk_label = QLabel("Risque objectif: -")
        self.ai_response_field = QPlainTextEdit()
        self.ai_response_field.setReadOnly(True)
        self.ai_response_field.setFixedHeight(96)
        self.build_ai_button = QPushButton("Demander a l'IA de construire")
        self.build_ai_button.setObjectName("PrimaryButton")
        self.build_ai_button.clicked.connect(self.request_ai_node)
        creator_layout.addWidget(self.ai_engine_combo)
        creator_layout.addWidget(self.ai_goal_field)
        creator_layout.addWidget(self.ai_risk_label)
        creator_layout.addWidget(self.ai_response_field)
        creator_layout.addWidget(self.build_ai_button)
        left_layout.addWidget(creator)
        splitter.addWidget(left)

        right = QFrame()
        right.setObjectName("Panel")
        form_layout = QVBoxLayout(right)
        form_layout.addWidget(QLabel("Configuration du noeud"))
        form = QFormLayout()
        self.id_field = QLineEdit()
        self.id_field.setReadOnly(True)
        self.name_field = QLineEdit()
        self.type_combo = QComboBox()
        self.type_combo.addItems(NODE_TYPES)
        self.type_combo.currentTextChanged.connect(self.apply_type_defaults)
        self.executor_combo = QComboBox()
        self.executor_combo.addItems(EXECUTORS)
        self.mode_combo = QComboBox()
        self.mode_combo.addItems(MODES)
        self.command_field = QLineEdit()
        self.description_field = QTextEdit()
        self.description_field.setFixedHeight(70)
        self.prompt_field = QTextEdit()
        self.prompt_field.setFixedHeight(90)
        self.guard_field = QTextEdit()
        self.guard_field.setFixedHeight(70)
        self.code_field = QTextEdit()
        self.code_field.setFixedHeight(120)
        self.inputs_field = QLineEdit()
        self.outputs_field = QLineEdit()
        for label, widget in [
            ("ID", self.id_field),
            ("Nom", self.name_field),
            ("Type", self.type_combo),
            ("Executeur", self.executor_combo),
            ("Mode", self.mode_combo),
            ("Commande", self.command_field),
            ("Description", self.description_field),
            ("Prompt", self.prompt_field),
            ("Garde-fou", self.guard_field),
            ("Code propose", self.code_field),
            ("Entrees", self.inputs_field),
            ("Sorties", self.outputs_field),
        ]:
            form.addRow(label, widget)
        form_layout.addLayout(form)
        save_button = QPushButton("Sauver le noeud")
        save_button.setObjectName("PrimaryButton")
        save_button.clicked.connect(self.save_node)
        form_layout.addWidget(save_button)
        form_layout.addStretch(1)
        splitter.addWidget(right)
        splitter.setSizes([330, 760])

    def reload_list(self) -> None:
        self.node_list.clear()
        for node in self.store.get("nodes", []):
            item = QListWidgetItem(f"{node.get('name')}  [{node.get('type')}]")
            item.setData(Qt.ItemDataRole.UserRole, node.get("id"))
            self.node_list.addItem(item)
        if self.node_list.count():
            self.node_list.setCurrentRow(0)

    def node_by_id(self, node_id: str) -> dict | None:
        return next((node for node in self.store.get("nodes", []) if node.get("id") == node_id), None)

    def on_node_selected(self, current: QListWidgetItem | None, _previous: QListWidgetItem | None = None) -> None:
        if not current:
            return
        node = self.node_by_id(current.data(Qt.ItemDataRole.UserRole))
        if node:
            self.load_node(node)

    def load_node(self, node: dict) -> None:
        self.current_id = node.get("id", "")
        self.id_field.setText(self.current_id)
        self.name_field.setText(node.get("name", ""))
        self.type_combo.setCurrentText(node.get("type", "script"))
        self.executor_combo.setCurrentText(node.get("executor", "script"))
        self.mode_combo.setCurrentText(node.get("mode", "dry-run"))
        self.command_field.setText(node.get("command", ""))
        self.description_field.setPlainText(node.get("description", ""))
        self.prompt_field.setPlainText(node.get("prompt", ""))
        self.guard_field.setPlainText(node.get("guard", ""))
        self.code_field.setPlainText(node.get("code", ""))
        self.inputs_field.setText(", ".join(node.get("inputs", [])))
        self.outputs_field.setText(", ".join(node.get("outputs", [])))

    def form_node(self) -> dict:
        return normalize_node(
            {
                "id": self.id_field.text().strip() or new_id("node"),
                "name": self.name_field.text().strip() or "Nouveau noeud",
                "type": self.type_combo.currentText(),
                "executor": self.executor_combo.currentText(),
                "mode": self.mode_combo.currentText(),
                "command": self.command_field.text().strip(),
                "description": read_field(self.description_field),
                "prompt": read_field(self.prompt_field),
                "guard": read_field(self.guard_field),
                "code": read_field(self.code_field),
                "inputs": split_ports(self.inputs_field.text()),
                "outputs": split_ports(self.outputs_field.text()),
            }
        )

    def save_node(self) -> None:
        node = self.form_node()
        nodes = self.store.setdefault("nodes", [])
        index = next((idx for idx, item in enumerate(nodes) if item.get("id") == node["id"]), -1)
        if index >= 0:
            nodes[index] = node
        else:
            nodes.append(node)
        self.store = save_nodes_store(self.store)
        self.nodes_changed.emit()
        self.reload_list()
        self.select_id(node["id"])

    def new_node(self) -> None:
        node = normalize_node({"id": new_id("node"), "name": "Nouveau noeud", "type": "script"})
        self.load_node(node)

    def duplicate_node(self) -> None:
        source = self.node_by_id(self.current_id)
        if not source:
            return
        node = dict(source)
        node["id"] = new_id("node")
        node["name"] = f"{source.get('name', 'Noeud')} copie"
        self.load_node(node)

    def delete_node(self) -> None:
        if not self.current_id:
            return
        answer = QMessageBox.question(self, "Retirer le noeud", "Retirer ce noeud de la bibliotheque ?")
        if answer != QMessageBox.StandardButton.Yes:
            return
        self.store["nodes"] = [node for node in self.store.get("nodes", []) if node.get("id") != self.current_id]
        self.store = save_nodes_store(self.store)
        self.current_id = ""
        self.nodes_changed.emit()
        self.reload_list()

    def select_id(self, node_id: str) -> None:
        for row in range(self.node_list.count()):
            item = self.node_list.item(row)
            if item.data(Qt.ItemDataRole.UserRole) == node_id:
                self.node_list.setCurrentRow(row)
                return

    def apply_type_defaults(self, node_type: str) -> None:
        self.executor_combo.setCurrentText(executor_for_type(node_type))
        self.mode_combo.setCurrentText(mode_for_type(node_type))

    def build_safe_node_from_goal(self) -> None:
        goal = self.ai_goal_field.toPlainText().strip()
        if not goal:
            self.ai_risk_label.setText("Risque objectif: 0/100 | demande vide")
            return
        risk = self.assess_goal_risk(goal)
        if risk:
            self.ai_risk_label.setText(f"Risque objectif: {risk['score']}/100 | bloque")
            QMessageBox.warning(self, "Noeud bloque", risk["reason"])
            return
        node = self.safe_node_from_goal(goal, self.ai_engine_combo.currentText())
        self.load_node(node)
        self.ai_risk_label.setText("Risque objectif: 0/100 | aucune action reelle")

    def assess_goal_risk(self, goal: str) -> dict | None:
        text = goal.lower()
        forbidden = {
            "supprimer": "Suppression interdite dans un noeud genere automatiquement.",
            "delete": "Suppression interdite dans un noeud genere automatiquement.",
            "rm ": "Suppression interdite dans un noeud genere automatiquement.",
            "rmdir": "Suppression interdite dans un noeud genere automatiquement.",
            "format": "Formatage interdit.",
            "push": "Push Git interdit dans un noeud genere automatiquement.",
            "deploy": "Deploiement interdit dans un noeud genere automatiquement.",
            "publier": "Publication interdite sans audit et validation.",
            "hostinger": "Publication Hostinger interdite dans un noeud genere automatiquement.",
            "--apply": "Action reelle interdite dans un noeud genere automatiquement.",
            "--run": "Execution forcee interdite dans un noeud genere automatiquement.",
            "--capture": "Capture reelle interdite dans un noeud genere automatiquement.",
            "token": "Secret ou token interdit.",
            "secret": "Secret interdit.",
            "env.local": "env.Local ne doit pas etre envoye ni manipule par un noeud genere.",
            "api key": "Cle API interdite.",
        }
        for needle, reason in forbidden.items():
            if needle in text:
                return {"score": 100, "reason": reason}
        return None

    def safe_node_from_goal(self, goal: str, engine: str) -> dict:
        text = goal.lower()
        base = {
            "id": new_id("node"),
            "guard": "Aucune action reelle; aucun secret; aucune suppression; validation obligatoire avant --apply.",
            "inputs": ["in"],
            "outputs": ["out"],
        }
        if any(word in text for word in ["git", "depot", "repo"]) and any(word in text for word in ["sans", "manquant", "absent", "verifie", "verifier"]):
            return normalize_node({
                **base,
                "name": "Verifier Git manquant",
                "type": "script",
                "executor": "script",
                "mode": "dry-run",
                "command": "npm run projects:git-check",
                "description": "Verifie quels projets ont Git sans modifier les dossiers.",
                "inputs": ["projects"],
                "outputs": ["git-status"],
            })
        if any(word in text for word in ["creer git", "initialiser git", "git init"]):
            return normalize_node({
                **base,
                "name": "Preparer creation Git",
                "type": "script",
                "executor": "script",
                "mode": "dry-run",
                "command": "npm run projects:git-ensure",
                "description": "Prepare la creation Git en dry-run, sans git init automatique.",
                "inputs": ["git-status"],
                "outputs": ["git-plan"],
            })
        if any(word in text for word in ["fiche", "site ma methode", "site"]):
            return normalize_node({
                **base,
                "name": "Preparer fiches site",
                "type": "script",
                "executor": "script",
                "mode": "dry-run",
                "command": "npm run projects:fiches-sync",
                "description": "Liste les fiches a creer ou synchroniser sans ecrire.",
                "inputs": ["changes"],
                "outputs": ["fiches-plan"],
            })
        if any(word in text for word in ["changement", "changements", "dirty", "modifie", "modifies"]):
            return normalize_node({
                **base,
                "name": "Verifier changements Git",
                "type": "script",
                "executor": "script",
                "mode": "dry-run",
                "command": "npm run git:changes",
                "description": "Produit un rapport des changements Git.",
                "inputs": ["git-ready"],
                "outputs": ["changes"],
            })
        if any(word in text for word in ["scan", "scanner", "inventaire", "projet"]):
            return normalize_node({
                **base,
                "name": "Scanner projets",
                "type": "script",
                "executor": "script",
                "mode": "dry-run",
                "command": "npm run projects:inventory",
                "description": "Scanne les projets et detecte les nouveaux dossiers.",
                "inputs": ["start"],
                "outputs": ["projects"],
            })
        engine_type = "qwen" if engine.lower().startswith("qwen") else "mistral"
        if engine == "Local securise":
            engine_type = "note"
        return normalize_node({
            **base,
            "name": f"Analyse {engine}" if engine != "Local securise" else "Note securisee",
            "type": engine_type,
            "executor": executor_for_type(engine_type),
            "mode": mode_for_type(engine_type),
            "prompt": goal,
            "description": "Noeud de proposition uniquement, sans modification automatique.",
            "inputs": ["context"],
            "outputs": ["proposal"],
        })

    def request_ai_node(self) -> None:
        goal = self.ai_goal_field.toPlainText().strip()
        if not goal:
            self.ai_risk_label.setText("Risque objectif: - | demande vide")
            return
        if self.ai_process and self.ai_process.state() != QProcess.ProcessState.NotRunning:
            QMessageBox.information(self, "Createur IA", "Une demande IA est deja en cours.")
            return
        engine = self.ai_engine_combo.currentText().lower()
        if engine.startswith("mistral"):
            engine_key = "mistral"
        elif engine.startswith("qwen"):
            engine_key = "qwen"
        else:
            engine_key = "local"
        self.ai_response_field.setPlainText("Demande envoyee au createur de noeuds...\nValidation risque 0 active.")
        self.ai_risk_label.setText("Risque objectif: analyse en cours")
        self.build_ai_button.setEnabled(False)
        self.ai_process = QProcess(self)
        self.ai_process.setWorkingDirectory(str(ORCHESTRATOR_ROOT))
        self.ai_process.setProgram(sys.executable)
        self.ai_process.setArguments([
            str(Path(__file__).resolve().parent / "node_ai_assistant.py"),
            "--engine",
            engine_key,
            "--goal",
            goal,
        ])
        self.ai_process.finished.connect(self.on_ai_finished)
        self.ai_process.start()

    def on_ai_finished(self, exit_code: int, _status) -> None:
        self.build_ai_button.setEnabled(True)
        if not self.ai_process:
            return
        stdout = bytes(self.ai_process.readAllStandardOutput()).decode("utf-8", errors="replace")
        stderr = bytes(self.ai_process.readAllStandardError()).decode("utf-8", errors="replace")
        if stderr.strip():
            self.ai_response_field.setPlainText(stderr.strip())
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            self.ai_risk_label.setText("Risque objectif: inconnu | reponse illisible")
            self.ai_response_field.setPlainText(stdout or stderr or "Aucune reponse IA.")
            self.ai_process = None
            return
        risk = payload.get("risk", {})
        source = payload.get("source", "-")
        if not payload.get("ok"):
            self.ai_risk_label.setText(f"Risque objectif: {risk.get('score', '?')}/100 | bloque")
            self.ai_response_field.setPlainText(json.dumps(payload, ensure_ascii=False, indent=2))
            self.ai_process = None
            return
        node = payload.get("node", {})
        self.load_node(node)
        self.ai_risk_label.setText(f"Risque objectif: {risk.get('score', 0)}/100 | source: {source}")
        self.ai_response_field.setPlainText(json.dumps(payload, ensure_ascii=False, indent=2))
        self.ai_process = None


class WorkflowEditor(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.nodes_store = load_nodes_store()
        self.workflows_store = load_workflows_store()
        self.node_items: dict[str, NodeItem] = {}
        self.edge_items: list[EdgeItem] = []
        self.current_workflow_id = self.default_workflow_id()
        self.process: QProcess | None = None
        self.running_item: NodeItem | None = None
        self.workflow_queue: list[NodeItem] = []
        self.workflow_skip_real_actions = False
        self.workflow_running = False
        self.build_ui()
        self.reload_all()

    def default_workflow_id(self) -> str:
        workflows = self.workflows_store.get("workflows", [])
        preferred = next((item for item in workflows if item.get("id") == "workflow-projets-git-fiches-graph"), None)
        if preferred:
            return preferred.get("id", "")
        populated = next((item for item in workflows if item.get("nodes")), None)
        return (populated or workflows[0] if workflows else {}).get("id", "")

    def build_ui(self) -> None:
        layout = QVBoxLayout(self)
        toolbar = QToolBar()
        self.workflow_combo = QComboBox()
        self.workflow_combo.currentIndexChanged.connect(self.on_workflow_changed)
        toolbar.addWidget(QLabel("Workflow "))
        toolbar.addWidget(self.workflow_combo)
        self.workflow_name_field = QLineEdit()
        self.workflow_name_field.setPlaceholderText("Nom du workflow")
        self.workflow_name_field.setMinimumWidth(260)
        self.workflow_name_field.editingFinished.connect(self.rename_current_workflow)
        toolbar.addWidget(self.workflow_name_field)
        for text, slot in [
            ("Nouveau workflow", self.new_workflow),
            ("Sauver", self.save_workflow),
            ("Retirer selection", self.delete_selected),
            ("Executer noeud", self.execute_selected),
            ("Tester workflow", self.test_workflow),
            ("Executer workflow", self.execute_workflow),
            ("Noeuds", self.toggle_palette_panel),
            ("Details", self.toggle_props_panel),
            ("Zoom +", self.zoom_in),
            ("Zoom -", self.zoom_out),
            ("Zoom 100%", self.zoom_reset),
        ]:
            action = QAction(text, self)
            action.triggered.connect(slot)
            toolbar.addAction(action)
        layout.addWidget(toolbar)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(self.splitter, 1)

        self.palette_panel = QFrame()
        self.palette_panel.setObjectName("Panel")
        palette_layout = QVBoxLayout(self.palette_panel)
        palette_layout.addWidget(QLabel("Noeuds disponibles"))
        self.palette_list = QListWidget()
        palette_layout.addWidget(self.palette_list)
        add_button = QPushButton("Ajouter le noeud a la grille")
        add_button.setObjectName("PrimaryButton")
        add_button.clicked.connect(self.add_palette_node)
        palette_layout.addWidget(add_button)
        self.splitter.addWidget(self.palette_panel)

        center = QFrame()
        center.setObjectName("CanvasPanel")
        center_layout = QVBoxLayout(center)
        self.scene = GridScene(self)
        self.scene.setSceneRect(-1400, -900, 2800, 1800)
        self.scene.selectionChanged.connect(self.on_scene_selection_changed)
        self.view = GraphView(self.scene)
        self.view.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        self.view.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.view.setViewportUpdateMode(QGraphicsView.ViewportUpdateMode.BoundingRectViewportUpdate)
        center_layout.addWidget(self.view, 1)
        self.terminal = QPlainTextEdit()
        self.terminal.setObjectName("Terminal")
        self.terminal.setReadOnly(True)
        self.terminal.setMaximumHeight(190)
        center_layout.addWidget(self.terminal)
        self.splitter.addWidget(center)

        self.props_panel = QFrame()
        self.props_panel.setObjectName("Panel")
        props_layout = QVBoxLayout(self.props_panel)
        props_layout.addWidget(QLabel("Details du noeud selectionne"))
        form = QFormLayout()
        self.selected_id_field = QLineEdit()
        self.selected_id_field.setReadOnly(True)
        self.selected_node_field = QLineEdit()
        self.selected_node_field.setReadOnly(True)
        self.instance_label_field = QLineEdit()
        self.instance_mode_combo = QComboBox()
        self.instance_mode_combo.addItems(MODES)
        self.instance_command_field = QLineEdit()
        self.instance_prompt_field = QTextEdit()
        self.instance_prompt_field.setFixedHeight(80)
        self.instance_guard_field = QTextEdit()
        self.instance_guard_field.setFixedHeight(70)
        for label, widget in [
            ("Instance", self.selected_id_field),
            ("Noeud", self.selected_node_field),
            ("Libelle", self.instance_label_field),
            ("Mode", self.instance_mode_combo),
            ("Commande", self.instance_command_field),
            ("Prompt", self.instance_prompt_field),
            ("Garde-fou", self.instance_guard_field),
        ]:
            form.addRow(label, widget)
        props_layout.addLayout(form)
        apply_button = QPushButton("Appliquer aux noeuds selectionnes")
        apply_button.clicked.connect(self.apply_instance_form)
        props_layout.addWidget(apply_button)
        props_layout.addStretch(1)
        self.splitter.addWidget(self.props_panel)
        self.splitter.setSizes([260, 780, 340])
        self.props_panel.setVisible(False)

    def reload_all(self) -> None:
        self.nodes_store = load_nodes_store()
        self.workflows_store = load_workflows_store()
        self.reload_palette()
        self.reload_workflow_combo()
        self.load_current_workflow()

    def reload_palette(self) -> None:
        self.palette_list.clear()
        for node in self.nodes_store.get("nodes", []):
            item = QListWidgetItem(f"{node.get('name')}  [{node.get('type')}]")
            item.setData(Qt.ItemDataRole.UserRole, node.get("id"))
            self.palette_list.addItem(item)
        if self.palette_list.count():
            self.palette_list.setCurrentRow(0)

    def reload_workflow_combo(self) -> None:
        self.workflow_combo.blockSignals(True)
        self.workflow_combo.clear()
        for workflow in self.workflows_store.get("workflows", []):
            self.workflow_combo.addItem(workflow.get("name", "Workflow"), workflow.get("id"))
        index = max(0, self.workflow_combo.findData(self.current_workflow_id))
        self.workflow_combo.setCurrentIndex(index)
        self.current_workflow_id = self.workflow_combo.currentData() or self.current_workflow_id
        current = self.current_workflow()
        self.workflow_name_field.setText(current.get("name", ""))
        self.workflow_combo.blockSignals(False)

    def node_map(self) -> dict[str, dict]:
        return {node.get("id"): node for node in self.nodes_store.get("nodes", [])}

    def current_workflow(self) -> dict:
        workflows = self.workflows_store.get("workflows", [])
        return next((item for item in workflows if item.get("id") == self.current_workflow_id), workflows[0])

    def on_workflow_changed(self) -> None:
        self.current_workflow_id = self.workflow_combo.currentData()
        self.workflow_name_field.setText(self.current_workflow().get("name", ""))
        self.load_current_workflow()

    def rename_current_workflow(self) -> None:
        workflow = self.current_workflow()
        name = self.workflow_name_field.text().strip() or "Workflow visuel"
        workflow["name"] = name
        current_index = self.workflow_combo.currentIndex()
        self.workflow_combo.setItemText(current_index, name)

    def load_current_workflow(self) -> None:
        self.scene.clear()
        self.node_items = {}
        self.edge_items = []
        workflow = self.current_workflow()
        definitions = self.node_map()
        for instance in workflow.get("nodes", []):
            definition = definitions.get(instance.get("nodeId"))
            if not definition:
                definition = {"id": instance.get("nodeId"), "name": "Noeud manquant", "type": "note", "mode": "manual"}
            item = NodeItem(instance, definition)
            item.setPos(float(instance.get("x", 0)), float(instance.get("y", 0)))
            self.scene.addItem(item)
            self.node_items[instance["id"]] = item
        for edge in workflow.get("connections", []):
            source = self.node_items.get(edge.get("from"))
            target = self.node_items.get(edge.get("to"))
            if source and target:
                self.add_edge(source, target)
        self.view.centerOn(0, 0)

    def zoom_in(self) -> None:
        self.view.zoom_by(1.15)

    def zoom_out(self) -> None:
        self.view.zoom_by(1 / 1.15)

    def zoom_reset(self) -> None:
        self.view.reset_zoom()

    def toggle_palette_panel(self) -> None:
        self.palette_panel.setHidden(not self.palette_panel.isHidden())

    def toggle_props_panel(self) -> None:
        self.props_panel.setHidden(not self.props_panel.isHidden())

    def add_palette_node(self) -> None:
        current = self.palette_list.currentItem()
        if not current:
            return
        node_id = current.data(Qt.ItemDataRole.UserRole)
        definition = self.node_map().get(node_id)
        if not definition:
            return
        center = self.view.mapToScene(self.view.viewport().rect().center())
        instance = {
            "id": new_id("inst"),
            "nodeId": node_id,
            "label": definition.get("name", "Noeud"),
            "x": center.x(),
            "y": center.y(),
            "command": "",
            "prompt": "",
            "guard": "",
            "mode": "",
        }
        item = NodeItem(instance, definition)
        item.setPos(center)
        self.scene.addItem(item)
        self.node_items[instance["id"]] = item
        item.setSelected(True)

    def selected_node_items(self) -> list[NodeItem]:
        return [item for item in self.scene.selectedItems() if isinstance(item, NodeItem)]

    def on_scene_selection_changed(self) -> None:
        selected = self.selected_node_items()
        if len(selected) != 1:
            self.clear_instance_form()
            return
        item = selected[0]
        definition = item.definition
        instance = item.instance
        self.selected_id_field.setText(instance.get("id", ""))
        self.selected_node_field.setText(definition.get("name", ""))
        self.instance_label_field.setText(instance.get("label") or definition.get("name", ""))
        self.instance_mode_combo.setCurrentText(instance.get("mode") or definition.get("mode", "dry-run"))
        self.instance_command_field.setText(instance.get("command") or definition.get("command", ""))
        self.instance_prompt_field.setPlainText(instance.get("prompt") or definition.get("prompt", ""))
        self.instance_guard_field.setPlainText(instance.get("guard") or definition.get("guard", ""))

    def clear_instance_form(self) -> None:
        for widget in (self.selected_id_field, self.selected_node_field, self.instance_label_field, self.instance_command_field):
            widget.clear()
        self.instance_prompt_field.clear()
        self.instance_guard_field.clear()

    def apply_instance_form(self) -> None:
        selected = self.selected_node_items()
        if len(selected) != 1:
            return
        item = selected[0]
        item.instance["label"] = self.instance_label_field.text().strip()
        item.instance["mode"] = self.instance_mode_combo.currentText()
        item.instance["command"] = self.instance_command_field.text().strip()
        item.instance["prompt"] = self.instance_prompt_field.toPlainText().strip()
        item.instance["guard"] = self.instance_guard_field.toPlainText().strip()
        item.update_text()

    def connect_selected(self) -> None:
        selected = self.selected_node_items()
        if len(selected) != 2:
            QMessageBox.information(self, "Connexion", "Selectionne exactement deux noeuds.")
            return
        selected.sort(key=lambda item: item.scenePos().x())
        self.add_edge(selected[0], selected[1])

    def add_edge(self, source: NodeItem, target: NodeItem) -> None:
        if source is target:
            return
        for edge in self.edge_items:
            if edge.source is source and edge.target is target:
                return
        edge = EdgeItem(source, target)
        self.scene.addItem(edge)
        self.edge_items.append(edge)

    def delete_selected(self) -> None:
        selected = self.selected_node_items()
        for item in selected:
            for edge in list(item.edges):
                edge.detach()
                if edge in self.edge_items:
                    self.edge_items.remove(edge)
                self.scene.removeItem(edge)
            self.node_items.pop(item.instance.get("id"), None)
            self.scene.removeItem(item)

    def new_workflow(self) -> None:
        workflow = {
            "id": new_id("workflow"),
            "name": "Nouveau workflow visuel",
            "status": "draft",
            "description": "",
            "nodes": [],
            "connections": [],
        }
        self.workflows_store.setdefault("workflows", []).insert(0, workflow)
        self.current_workflow_id = workflow["id"]
        self.workflows_store = save_workflows_store(self.workflows_store)
        self.reload_all()

    def save_workflow(self) -> None:
        workflow = self.current_workflow()
        workflow["name"] = self.workflow_name_field.text().strip() or workflow.get("name", "Workflow visuel")
        workflow["nodes"] = []
        for item in self.node_items.values():
            item.instance["x"] = item.pos().x()
            item.instance["y"] = item.pos().y()
            workflow["nodes"].append(dict(item.instance))
        workflow["connections"] = [
            {"from": edge.source.instance.get("id"), "to": edge.target.instance.get("id")}
            for edge in self.edge_items
        ]
        workflows = self.workflows_store.get("workflows", [])
        index = next((idx for idx, item in enumerate(workflows) if item.get("id") == workflow.get("id")), -1)
        if index >= 0:
            workflows[index] = workflow
        else:
            workflows.append(workflow)
        self.workflows_store = save_workflows_store(self.workflows_store)
        self.append_terminal(f"Sauvegarde: {NODE_WORKFLOWS_PATH}")

    def execute_selected(self) -> None:
        selected = self.selected_node_items()
        if len(selected) != 1:
            QMessageBox.information(self, "Execution", "Selectionne un seul noeud.")
            return
        if self.process and self.process.state() != QProcess.ProcessState.NotRunning:
            QMessageBox.warning(self, "Execution", "Une commande est deja en cours.")
            return
        item = selected[0]
        self.workflow_queue = []
        self.workflow_skip_real_actions = False
        self.workflow_running = False
        self.start_node_execution(item, skip_real_actions=False)

    def test_workflow(self) -> None:
        self.start_workflow(skip_real_actions=True)

    def execute_workflow(self) -> None:
        self.start_workflow(skip_real_actions=False)

    def start_workflow(self, skip_real_actions: bool) -> None:
        if self.process and self.process.state() != QProcess.ProcessState.NotRunning:
            QMessageBox.warning(self, "Execution", "Une commande est deja en cours.")
            return
        ordered = self.execution_order()
        if not ordered:
            QMessageBox.information(self, "Workflow", "Aucun noeud a executer.")
            return
        for item in self.node_items.values():
            item.set_state("idle")
        self.workflow_queue = ordered
        self.workflow_skip_real_actions = skip_real_actions
        self.workflow_running = True
        mode = "test dry-run" if skip_real_actions else "execution complete"
        self.append_terminal(f"\n=== Workflow: {self.current_workflow().get('name', 'Workflow')} ({mode}) ===\n")
        self.start_next_workflow_node()

    def execution_order(self) -> list[NodeItem]:
        nodes = list(self.node_items.values())
        if not nodes:
            return []
        by_id = {item.instance.get("id"): item for item in nodes}
        incoming = {item.instance.get("id"): 0 for item in nodes}
        outgoing: dict[str, list[str]] = {item.instance.get("id"): [] for item in nodes}
        for edge in self.edge_items:
            source_id = edge.source.instance.get("id")
            target_id = edge.target.instance.get("id")
            if source_id in outgoing and target_id in incoming:
                outgoing[source_id].append(target_id)
                incoming[target_id] += 1
        ready = sorted([node_id for node_id, count in incoming.items() if count == 0], key=lambda node_id: by_id[node_id].scenePos().x())
        ordered = []
        while ready:
            node_id = ready.pop(0)
            ordered.append(by_id[node_id])
            for target_id in outgoing[node_id]:
                incoming[target_id] -= 1
                if incoming[target_id] == 0:
                    ready.append(target_id)
                    ready.sort(key=lambda item_id: by_id[item_id].scenePos().x())
        if len(ordered) != len(nodes):
            remaining = [item for item in nodes if item not in ordered]
            remaining.sort(key=lambda item: (item.scenePos().x(), item.scenePos().y()))
            ordered.extend(remaining)
        return ordered

    def start_next_workflow_node(self) -> None:
        if not self.workflow_queue:
            self.append_terminal("=== Workflow termine ===\n")
            self.workflow_skip_real_actions = False
            self.workflow_running = False
            return
        item = self.workflow_queue.pop(0)
        started = self.start_node_execution(item, skip_real_actions=self.workflow_skip_real_actions, workflow_mode=True)
        if not started:
            self.start_next_workflow_node()

    def start_node_execution(self, item: NodeItem, skip_real_actions: bool, workflow_mode: bool = False) -> bool:
        command = (item.instance.get("command") or item.definition.get("command") or "").strip()
        parsed = self.parse_npm_command(command)
        if not parsed:
            self.append_terminal(f"SKIP {item.instance.get('label')}: aucune commande npm valide.\n")
            item.set_state("ok")
            return False
        script_name, extra_args = parsed
        real_action = any(arg in {"--apply", "--run", "--capture"} for arg in extra_args)
        if real_action and skip_real_actions:
            self.append_terminal(f"SKIP action reelle: {command}\n")
            item.set_state("ok")
            return False
        if real_action:
            answer = QMessageBox.question(self, "Action reelle", f"Lancer cette commande ?\n\n{command}")
            if answer != QMessageBox.StandardButton.Yes:
                self.workflow_queue = []
                self.append_terminal("Workflow stoppe par validation utilisateur.\n")
                return False
        self.running_item = item
        item.set_state("running")
        self.append_terminal(f"\n> {command}\n")
        self.process = QProcess(self)
        self.process.setWorkingDirectory(str(ORCHESTRATOR_ROOT))
        self.process.setProgram("npm.cmd" if os.name == "nt" else "npm")
        self.process.setArguments(["run", script_name, *extra_args])
        self.process.readyReadStandardOutput.connect(self.on_process_stdout)
        self.process.readyReadStandardError.connect(self.on_process_stderr)
        self.process.finished.connect(self.on_process_finished)
        self.process.start()
        return True

    def parse_npm_command(self, command: str) -> tuple[str, list[str]] | None:
        parts = command.split()
        if len(parts) < 3 or parts[0].lower() != "npm" or parts[1].lower() != "run":
            return None
        return parts[2], parts[3:]

    def on_process_stdout(self) -> None:
        if not self.process:
            return
        self.append_terminal(bytes(self.process.readAllStandardOutput()).decode("utf-8", errors="replace"))

    def on_process_stderr(self) -> None:
        if not self.process:
            return
        self.append_terminal(bytes(self.process.readAllStandardError()).decode("utf-8", errors="replace"))

    def on_process_finished(self, exit_code: int, _status) -> None:
        self.append_terminal(f"\nExit: {exit_code}\n")
        if self.running_item:
            self.running_item.set_state("ok" if exit_code == 0 else "error")
        self.running_item = None
        if self.workflow_queue:
            if exit_code == 0:
                self.start_next_workflow_node()
            else:
                self.append_terminal("Workflow stoppe: un noeud a echoue.\n")
                self.workflow_queue = []
                self.workflow_skip_real_actions = False
                self.workflow_running = False
        elif self.workflow_running:
            if exit_code == 0:
                self.append_terminal("=== Workflow termine ===\n")
            else:
                self.append_terminal("Workflow stoppe: un noeud a echoue.\n")
            self.workflow_skip_real_actions = False
            self.workflow_running = False

    def append_terminal(self, text: str) -> None:
        self.terminal.moveCursor(QTextCursor.MoveOperation.End)
        self.terminal.insertPlainText(text)
        self.terminal.moveCursor(QTextCursor.MoveOperation.End)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        ensure_graph_store()
        self.setWindowTitle("Workflow Node Studio IA")
        self.resize(1480, 900)
        tabs = QTabWidget()
        self.node_editor = NodeEditor()
        self.workflow_editor = WorkflowEditor()
        self.node_editor.nodes_changed.connect(self.workflow_editor.reload_all)
        tabs.addTab(self.node_editor, "Noeuds")
        tabs.addTab(self.workflow_editor, "Workflows")
        self.setCentralWidget(tabs)
        self.statusBar().showMessage(f"Noeuds: {NODES_PATH}")


def apply_style(app: QApplication) -> None:
    app.setStyle("Fusion")
    app.setStyleSheet(
        """
        QWidget {
            font-family: "Segoe UI";
            font-size: 10pt;
            color: #1e293b;
        }
        QMainWindow, QTabWidget::pane {
            background: #f8fafc;
        }
        QFrame#Panel, QFrame#CanvasPanel {
            background: #ffffff;
            border: 1px solid #d8e0ea;
            border-radius: 8px;
        }
        QFrame#SubPanel {
            background: #f8fafc;
            border: 1px solid #d8e0ea;
            border-radius: 8px;
            margin-top: 8px;
            padding: 6px;
        }
        QLabel {
            font-weight: 600;
        }
        QLineEdit, QTextEdit, QPlainTextEdit, QComboBox, QListWidget {
            background: #ffffff;
            color: #1e293b;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 6px;
        }
        QComboBox QAbstractItemView {
            background: #ffffff;
            color: #1e293b;
            selection-background-color: #dbeafe;
            selection-color: #0f172a;
            border: 1px solid #cbd5e1;
        }
        QPushButton {
            background: #eef4ff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 10px;
        }
        QPushButton:hover {
            background: #dbeafe;
        }
        QPushButton#PrimaryButton {
            background: #2563eb;
            color: #ffffff;
            border: 1px solid #2563eb;
            font-weight: 600;
        }
        QToolBar {
            background: #f8fafc;
            border: 0;
            spacing: 8px;
            padding: 6px;
        }
        QToolButton {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 7px 10px;
        }
        QPlainTextEdit#Terminal {
            background: #0f172a;
            color: #e2e8f0;
            font-family: Consolas;
            font-size: 9pt;
        }
        """
    )


def main() -> int:
    app = QApplication(sys.argv)
    apply_style(app)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
