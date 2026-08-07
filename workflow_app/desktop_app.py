from __future__ import annotations

import json
import os
import subprocess
import threading
import tkinter as tk
import tkinter.font as tkfont
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from store import (
    ORCHESTRATOR_ROOT,
    WORKFLOWS_PATH,
    build_state,
    create_workflow,
    delete_workflow,
    dry_run_workflow,
    duplicate_workflow,
    ensure_store,
    executor_for_step_type,
    label_for_step_type,
    default_mode_for_step_type,
    new_id,
    save_workflow,
)


TYPE_LABELS = {
    "script": "Script local",
    "mistral": "Mistral",
    "qwen": "Qwen",
    "gate": "Validation",
    "note": "Note",
}

MODE_LABELS = {
    "dry-run": "Dry-run",
    "proposal-only": "Proposition seule",
    "approval-gate": "Validation requise",
    "manual": "Manuel",
}

TYPE_HELP = {
    "script": "Commande locale npm. A utiliser pour scanner, auditer, verifier ou generer un rapport.",
    "mistral": "Demande a Mistral. Sert a proposer, resumer, classer ou analyser sans modifier les fichiers.",
    "qwen": "Demande a Qwen. Utile pour un second avis technique, un diagnostic ou une verification logique.",
    "gate": "Pause de validation. Le workflow attend ton accord avant une action sensible.",
    "note": "Note de suivi. Sert a documenter une decision, une observation ou une memoire projet.",
}

MODE_HELP = {
    "dry-run": "Teste ou produit un rapport avant action reelle. C'est le mode par defaut pour les scripts.",
    "proposal-only": "L'IA repond avec une proposition. Aucune modification automatique.",
    "approval-gate": "Bloque la suite tant que tu n'as pas valide manuellement.",
    "manual": "Etape informative ou action faite a la main.",
}

EXECUTOR_HELP = {
    "script": "Le terminal local lance une commande npm autorisee.",
    "codex": "Codex supervise, documente ou attend ta validation.",
    "mistral-api": "Mistral recoit un prompt borne et renvoie une proposition.",
    "alibaba-api": "Qwen recoit un prompt borne et renvoie un diagnostic.",
}

PROMPT_HINTS = {
    "script": "Pour un script, le prompt est optionnel: la commande fait l'action. Utilise-le pour noter le contexte.",
    "mistral": "Pour Mistral, ecris la mission exacte, les limites, puis le format de reponse attendu.",
    "qwen": "Pour Qwen, demande plutot un diagnostic technique, une verification ou un second avis.",
    "gate": "Pour une validation, note ce que tu dois verifier avant de continuer.",
    "note": "Pour une note, ecris la decision ou l'apprentissage a conserver.",
}

PROMPT_EXAMPLES = {
    "script": "Scanner les projets et produire un resume clair des changements detectes, sans modifier les fichiers.",
    "mistral": "Analyse ce workflow et propose les 3 prochaines actions utiles. Ne demande aucun secret. Reponds en liste courte avec risques et priorites.",
    "qwen": "Verifie la logique technique de cette etape. Signale les erreurs possibles, les dependances manquantes et les tests a lancer.",
    "gate": "Valider que le rapport dry-run est correct, que les secrets ne sont pas exposes et que l'action peut continuer.",
    "note": "Documenter la decision, le contexte et ce qu'il faudra retenir pour les prochains workflows.",
}

GUARD_HINTS = {
    "script": "Le garde-fou dit ce qui est interdit ou obligatoire avant execution: dry-run, pas de suppression, pas de publication.",
    "mistral": "Indique les limites: aucun secret, contexte minimal, proposition seulement.",
    "qwen": "Indique les limites: aucun secret, aucun changement direct, diagnostic seulement.",
    "gate": "Indique le critere exact qui permet de valider ou de bloquer.",
    "note": "Indique ou la note doit etre conservee et pourquoi.",
}

COMMAND_EXPLANATIONS = {
    "scan": "Scanne les dossiers projets et produit une vue de base.",
    "projects:inventory": "Archive la liste des projets et detecte les nouveaux dossiers.",
    "projects:git-check": "Verifie quels projets ont Git et leur etat clean/dirty.",
    "projects:git-ensure": "Prepare ou cree Git dans les projets qui n'en ont pas.",
    "projects:fiches-sync": "Met a jour les fiches seulement si changement ou fiche manquante.",
    "check": "Controle la syntaxe des fichiers de l'orchestrateur.",
    "registry:check": "Verifie que le registre projets est coherent.",
    "status:check": "Controle les statuts renseignes dans les fiches projets.",
    "expected:check": "Compare les projets attendus avec les projets detectes.",
    "detect:stack": "Detecte les technologies utilisees dans les projets.",
    "audit:initial": "Produit un audit initial de l'orchestrateur.",
    "audit:compliance": "Verifie le respect des instructions et contraintes.",
    "plan:coverage": "Controle que le plan couvre les actions attendues.",
    "safety:check": "Verifie les garde-fous dry-run et anti-publication.",
    "security": "Audite les risques de securite et secrets exposes.",
    "optimization": "Cherche les pistes d'optimisation du projet.",
    "architecture": "Analyse la structure technique et les dependances.",
    "cleanup:audit": "Repere les fichiers a nettoyer ou archiver.",
    "cleanup:archive": "Archive les elements inutilises sans suppression definitive.",
    "verify:functionality": "Verifie le fonctionnement general d'un projet.",
    "repair:functionality": "Prepare ou applique des corrections de fonctionnement.",
    "fiches": "Met a jour les fiches documentaires des projets.",
    "docs:check": "Controle la presence et la coherence de la documentation.",
    "site-ma-methode": "Synchronise le hub Site Ma Methode avec les projets.",
    "thumbnails": "Genere des miniatures pour les projets.",
    "thumbnails:import-ai": "Importe la derniere miniature generee par IA.",
    "site:check": "Verifie la synchronisation du hub Site Ma Methode.",
    "site:render-check": "Controle que le rendu du site se genere correctement.",
    "screenshots": "Capture des captures d'ecran des projets.",
    "screenshots:check": "Controle la couverture des captures d'ecran.",
    "backup:prepare": "Prepare un backup Git avant action sensible.",
    "backup:status": "Affiche l'etat du backup Git.",
    "git:changes": "Produit un rapport des changements Git.",
    "git:guard": "Verifie que le backup Git est pret avant modification.",
    "memory:central": "Synchronise la memoire centrale.",
    "memory:project": "Synchronise la memoire projet.",
    "skills:install": "Installe ou met a jour les skills Codex.",
    "skills:check": "Verifie les skills sans installation reelle.",
    "agents:sync": "Synchronise les agents Codex.",
    "github:prepare": "Prepare un projet pour publication GitHub.",
    "github:verify-repos": "Verifie ou cree les depots GitHub attendus.",
    "publication:check": "Controle les preconditions avant publication.",
    "hostinger:check": "Controle les preconditions avant publication Hostinger.",
    "github:readme": "Genere un README francais pour GitHub.",
    "github:sync": "Synchronise un projet vers GitHub.",
    "subagent:dispatch": "Distribue une tache a un sous-agent IA.",
    "subagents": "Alias pour distribuer une tache aux sous-agents.",
    "subagents:check": "Controle la securite des sous-agents.",
    "subagent:mistral": "Lance une tache bornee avec Mistral.",
    "subagent:qwen": "Lance une tache bornee avec Qwen.",
    "subagent:merge": "Fusionne les rapports des sous-agents.",
    "daily": "Lance la routine quotidienne.",
    "weekly": "Lance la routine hebdomadaire.",
    "monthly": "Lance la routine mensuelle.",
    "dashboard": "Lance le tableau de bord local existant.",
}

STATUS_LABELS = {
    "draft": "Brouillon",
    "ready": "Pret",
    "paused": "En pause",
}

COLORS = {
    "bg": "#f8fafc",
    "panel": "#ffffff",
    "line": "#d8e0ea",
    "text": "#1e293b",
    "muted": "#64748b",
    "blue": "#2563eb",
    "blue_soft": "#dbeafe",
    "green": "#16a34a",
    "green_soft": "#dcfce7",
    "orange": "#f97316",
    "orange_soft": "#ffedd5",
    "purple": "#7c3aed",
    "purple_soft": "#ede9fe",
    "red": "#dc2626",
    "red_soft": "#fee2e2",
}


class WorkflowStudio(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        ensure_store()
        self.title("Workflow Studio IA")
        self.geometry("1420x860")
        self.minsize(860, 560)

        self.state = build_state()
        self.workflows = self.state.get("workflows", [])
        self.selected_workflow_id = self.workflows[0]["id"] if self.workflows else ""
        self.selected_step_id = self.first_step_id(self.current_workflow())
        self.workflow_dirty = False
        self.is_rendering = False
        self.command_running = False
        self.terminal_height = 5
        self.terminal_drag_start_y = 0
        self.terminal_drag_start_height = self.terminal_height
        self.terminal_dragging = False

        self.workflow_vars = {
            "name": tk.StringVar(),
            "status": tk.StringVar(value="draft"),
            "owner": tk.StringVar(),
            "projectScope": tk.StringVar(),
        }
        self.step_vars = {
            "title": tk.StringVar(),
            "type": tk.StringVar(value="script"),
            "executor": tk.StringVar(value="script"),
            "mode": tk.StringVar(value="dry-run"),
            "command": tk.StringVar(),
            "output": tk.StringVar(),
        }
        self.command_filter_var = tk.StringVar()
        self.command_category_var = tk.StringVar(value="Toutes")
        self.command_sort_var = tk.StringVar(value="Nom A-Z")
        self.visible_commands = []

        self.configure(bg=COLORS["bg"])
        self.setup_style()
        self.build_shell()
        self.bind_events()
        self.render_all()
        self.set_status("Pret")

    def setup_style(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 10), background=COLORS["bg"], foreground=COLORS["text"])
        style.configure("App.TFrame", background=COLORS["bg"])
        style.configure("Panel.TFrame", background=COLORS["panel"], relief="flat")
        style.configure("Top.TFrame", background=COLORS["bg"])
        style.configure("Title.TLabel", background=COLORS["bg"], foreground=COLORS["text"], font=("Segoe UI", 18, "bold"))
        style.configure("PanelTitle.TLabel", background=COLORS["panel"], foreground=COLORS["text"], font=("Segoe UI", 11, "bold"))
        style.configure("Eyebrow.TLabel", background=COLORS["panel"], foreground=COLORS["muted"], font=("Consolas", 8))
        style.configure("Metric.TLabel", background=COLORS["panel"], foreground=COLORS["muted"], font=("Consolas", 8))
        style.configure("MetricValue.TLabel", background=COLORS["panel"], foreground=COLORS["blue"], font=("Consolas", 22, "bold"))
        style.configure("Muted.TLabel", background=COLORS["panel"], foreground=COLORS["muted"])
        style.configure("Primary.TButton", background=COLORS["blue"], foreground="#ffffff", borderwidth=0, padding=(12, 8))
        style.map("Primary.TButton", background=[("active", "#1d4ed8")])
        style.configure("Tool.TButton", background="#eef4ff", foreground=COLORS["text"], borderwidth=1, padding=(10, 7))
        style.map("Tool.TButton", background=[("active", "#dbeafe")])
        style.configure("Danger.TButton", background=COLORS["red_soft"], foreground=COLORS["red"], borderwidth=1, padding=(10, 7))
        style.map("Danger.TButton", background=[("active", "#fecaca")])
        style.configure("Workflow.Treeview", background=COLORS["panel"], fieldbackground=COLORS["panel"], foreground=COLORS["text"], rowheight=42)
        style.configure("Workflow.Treeview.Heading", background="#eff4fb", foreground=COLORS["muted"], font=("Consolas", 8, "bold"))
        style.map("Workflow.Treeview", background=[("selected", COLORS["blue_soft"])], foreground=[("selected", COLORS["text"])])
        style.configure("Command.Treeview", background="#ffffff", fieldbackground="#ffffff", foreground=COLORS["text"], rowheight=28)
        style.configure("Command.Treeview.Heading", background="#eff4fb", foreground=COLORS["muted"], font=("Consolas", 8, "bold"))
        style.map("Command.Treeview", background=[("selected", COLORS["orange_soft"])], foreground=[("selected", COLORS["text"])])

    def build_shell(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)

        self.shell_canvas = tk.Canvas(self, bg=COLORS["bg"], bd=0, highlightthickness=0)
        self.shell_canvas.grid(row=0, column=0, sticky="nsew")
        shell_scroll_y = ttk.Scrollbar(self, orient="vertical", command=self.shell_canvas.yview)
        shell_scroll_y.grid(row=0, column=1, sticky="ns")
        shell_scroll_x = ttk.Scrollbar(self, orient="horizontal", command=self.shell_canvas.xview)
        shell_scroll_x.grid(row=1, column=0, sticky="ew")
        self.shell_canvas.configure(yscrollcommand=shell_scroll_y.set, xscrollcommand=shell_scroll_x.set)

        self.shell_frame = ttk.Frame(self.shell_canvas, style="App.TFrame")
        self.shell_window = self.shell_canvas.create_window((0, 0), window=self.shell_frame, anchor="nw")
        self.shell_frame.bind("<Configure>", self.update_shell_scroll_region)
        self.shell_canvas.bind("<Configure>", self.resize_shell_window)
        self.shell_canvas.bind("<MouseWheel>", self.scroll_shell_vertical)
        self.shell_frame.bind("<MouseWheel>", self.scroll_shell_vertical)
        self.shell_canvas.bind("<Shift-MouseWheel>", self.scroll_shell_horizontal)
        self.shell_frame.bind("<Shift-MouseWheel>", self.scroll_shell_horizontal)

        root = self.shell_frame
        root.columnconfigure(0, weight=1)
        root.rowconfigure(2, weight=1)

        topbar = ttk.Frame(root, style="Top.TFrame", padding=(16, 14, 16, 8))
        topbar.grid(row=0, column=0, sticky="ew")
        topbar.columnconfigure(0, weight=1)

        title_area = ttk.Frame(topbar, style="Top.TFrame")
        title_area.grid(row=0, column=0, sticky="w")
        ttk.Label(title_area, text="Cerveau IA", style="Muted.TLabel", background=COLORS["bg"], font=("Consolas", 8)).grid(row=0, column=0, sticky="w")
        ttk.Label(title_area, text="Workflow Studio IA", style="Title.TLabel").grid(row=1, column=0, sticky="w")

        actions = ttk.Frame(topbar, style="Top.TFrame")
        actions.grid(row=0, column=1, sticky="e")
        ttk.Button(actions, text="Nouveau", style="Tool.TButton", command=self.create_new_workflow).grid(row=0, column=0, padx=4)
        ttk.Button(actions, text="Sauver", style="Primary.TButton", command=self.save_current_workflow).grid(row=0, column=1, padx=4)
        ttk.Button(actions, text="Dry-run", style="Tool.TButton", command=self.run_dry_run).grid(row=0, column=2, padx=4)

        self.metrics_frame = ttk.Frame(root, style="App.TFrame", padding=(16, 0, 16, 10))
        self.metrics_frame.grid(row=1, column=0, sticky="ew")
        for index in range(4):
            self.metrics_frame.columnconfigure(index, weight=1)

        body = ttk.Frame(root, style="App.TFrame", padding=(16, 0, 16, 10))
        body.grid(row=2, column=0, sticky="nsew")
        body.columnconfigure(0, weight=0, minsize=292)
        body.columnconfigure(1, weight=1, minsize=520)
        body.columnconfigure(2, weight=0, minsize=360)
        body.rowconfigure(0, weight=1)

        self.build_workflow_list(body)
        self.build_builder(body)
        self.build_editor(body)

        self.build_log_panel(root)

    def build_workflow_list(self, parent: ttk.Frame) -> None:
        panel = ttk.Frame(parent, style="Panel.TFrame", padding=12)
        panel.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        panel.rowconfigure(2, weight=1)
        panel.columnconfigure(0, weight=1)
        ttk.Label(panel, text="BIBLIOTHEQUE", style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(panel, text="Workflows", style="PanelTitle.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 10))

        self.workflow_tree = ttk.Treeview(panel, columns=("status", "steps"), show="tree headings", style="Workflow.Treeview", selectmode="browse")
        self.workflow_tree.heading("#0", text="Nom")
        self.workflow_tree.heading("status", text="Statut")
        self.workflow_tree.heading("steps", text="Etapes")
        self.workflow_tree.column("#0", width=160, stretch=True)
        self.workflow_tree.column("status", width=72, anchor="center")
        self.workflow_tree.column("steps", width=54, anchor="center")
        self.workflow_tree.grid(row=2, column=0, sticky="nsew")

        list_actions = ttk.Frame(panel, style="Panel.TFrame")
        list_actions.grid(row=3, column=0, sticky="ew", pady=(10, 0))
        list_actions.columnconfigure(0, weight=1)
        ttk.Button(list_actions, text="Dupliquer", style="Tool.TButton", command=self.duplicate_current_workflow).grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Button(list_actions, text="Exporter JSON", style="Tool.TButton", command=self.export_current_workflow).grid(row=1, column=0, sticky="ew", pady=(0, 6))
        ttk.Button(list_actions, text="Retirer", style="Danger.TButton", command=self.delete_current_workflow).grid(row=2, column=0, sticky="ew")

    def build_builder(self, parent: ttk.Frame) -> None:
        panel = ttk.Frame(parent, style="Panel.TFrame", padding=12)
        panel.grid(row=0, column=1, sticky="nsew", padx=(0, 10))
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(5, weight=1)

        header = ttk.Frame(panel, style="Panel.TFrame")
        header.grid(row=0, column=0, sticky="ew")
        for index in range(4):
            header.columnconfigure(index, weight=1)
        self.add_entry(header, "Nom", self.workflow_vars["name"], 0, 0, width=30)
        self.add_combo(header, "Statut", self.workflow_vars["status"], list(STATUS_LABELS.keys()), 0, 1)
        self.add_entry(header, "Responsable", self.workflow_vars["owner"], 0, 2)
        self.add_entry(header, "Portee", self.workflow_vars["projectScope"], 0, 3)

        ttk.Label(panel, text="Objectif", style="Eyebrow.TLabel").grid(row=1, column=0, sticky="w", pady=(12, 4))
        self.objective_text = tk.Text(panel, height=3, wrap="word", bg="#fafdff", fg=COLORS["text"], relief="solid", bd=1, highlightthickness=1, highlightcolor=COLORS["blue"])
        self.objective_text.grid(row=2, column=0, sticky="ew")

        toolbar = ttk.Frame(panel, style="Panel.TFrame")
        toolbar.grid(row=3, column=0, sticky="ew", pady=(12, 8))
        for index, (step_type, label) in enumerate(TYPE_LABELS.items()):
            ttk.Button(toolbar, text=label, style="Tool.TButton", command=lambda value=step_type: self.add_step(value)).grid(row=0, column=index, padx=(0, 6))

        ttk.Label(panel, text="CONSTRUCTEUR", style="Eyebrow.TLabel").grid(row=4, column=0, sticky="w", pady=(4, 6))
        board_frame = ttk.Frame(panel, style="Panel.TFrame")
        board_frame.grid(row=5, column=0, sticky="nsew")
        board_frame.columnconfigure(0, weight=1)
        board_frame.rowconfigure(0, weight=1)

        self.step_canvas = tk.Canvas(board_frame, bg="#ffffff", bd=0, highlightthickness=1, highlightbackground=COLORS["line"])
        self.step_canvas.grid(row=0, column=0, sticky="nsew")
        step_scroll = ttk.Scrollbar(board_frame, orient="vertical", command=self.step_canvas.yview)
        step_scroll.grid(row=0, column=1, sticky="ns")
        self.step_canvas.configure(yscrollcommand=step_scroll.set)
        self.step_container = ttk.Frame(self.step_canvas, style="Panel.TFrame")
        self.step_window = self.step_canvas.create_window((0, 0), window=self.step_container, anchor="nw")
        self.step_container.bind("<Configure>", lambda _event: self.step_canvas.configure(scrollregion=self.step_canvas.bbox("all")))
        self.step_canvas.bind("<Configure>", lambda event: self.step_canvas.itemconfigure(self.step_window, width=event.width))

    def build_command_picker(self, parent: ttk.Frame, row: int) -> None:
        panel = ttk.Frame(parent, style="Panel.TFrame")
        panel.grid(row=row, column=0, sticky="ew", pady=(12, 0))
        panel.columnconfigure(0, weight=1)

        header = ttk.Frame(panel, style="Panel.TFrame")
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="COMMANDES", style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w")
        self.command_count_label = ttk.Label(header, text="0", style="Muted.TLabel")
        self.command_count_label.grid(row=0, column=1, sticky="e")

        filters = ttk.Frame(panel, style="Panel.TFrame")
        filters.grid(row=1, column=0, sticky="ew", pady=(6, 6))
        filters.columnconfigure(0, weight=1)
        self.command_filter_entry = ttk.Entry(filters, textvariable=self.command_filter_var)
        self.command_filter_entry.grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self.command_category_combo = ttk.Combobox(filters, textvariable=self.command_category_var, state="readonly", width=18)
        self.command_category_combo.grid(row=0, column=1, sticky="ew", padx=(0, 6))
        self.command_sort_combo = ttk.Combobox(filters, textvariable=self.command_sort_var, values=["Nom A-Z", "Categorie", "Explication", "Commande"], state="readonly", width=14)
        self.command_sort_combo.grid(row=0, column=2, sticky="ew", padx=(0, 6))
        ttk.Button(filters, text="Utiliser", style="Primary.TButton", command=self.use_selected_command).grid(row=0, column=3, sticky="e")

        list_frame = ttk.Frame(panel, style="Panel.TFrame")
        list_frame.grid(row=2, column=0, sticky="ew")
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)
        self.command_tree = ttk.Treeview(
            list_frame,
            columns=("category", "description", "command"),
            show="tree headings",
            height=4,
            style="Command.Treeview",
            selectmode="browse",
        )
        self.command_tree.heading("#0", text="Script")
        self.command_tree.heading("category", text="Categorie")
        self.command_tree.heading("description", text="Explication")
        self.command_tree.heading("command", text="Commande")
        self.command_tree.column("#0", width=150, stretch=False)
        self.command_tree.column("category", width=105, anchor="center", stretch=False)
        self.command_tree.column("description", width=320, stretch=True)
        self.command_tree.column("command", width=300, stretch=True)
        self.command_tree.grid(row=0, column=0, sticky="ew")
        command_scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.command_tree.yview)
        command_scroll.grid(row=0, column=1, sticky="ns")
        command_scroll_x = ttk.Scrollbar(list_frame, orient="horizontal", command=self.command_tree.xview)
        command_scroll_x.grid(row=1, column=0, sticky="ew")
        self.command_tree.configure(yscrollcommand=command_scroll.set, xscrollcommand=command_scroll_x.set)

    def build_editor(self, parent: ttk.Frame) -> None:
        panel = ttk.Frame(parent, style="Panel.TFrame", padding=12)
        panel.grid(row=0, column=2, sticky="nsew")
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(15, weight=1)
        panel.bind("<Configure>", self.update_help_wrap)

        head = ttk.Frame(panel, style="Panel.TFrame")
        head.grid(row=0, column=0, sticky="ew")
        head.columnconfigure(0, weight=1)
        ttk.Label(head, text="ETAPE", style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w")
        self.editor_title = ttk.Label(head, text="Selection", style="PanelTitle.TLabel")
        self.editor_title.grid(row=1, column=0, sticky="w", pady=(2, 10))
        move = ttk.Frame(head, style="Panel.TFrame")
        move.grid(row=0, column=1, rowspan=2, sticky="e")
        ttk.Button(move, text="Monter", style="Tool.TButton", command=lambda: self.move_step(-1)).grid(row=0, column=0, padx=(0, 4))
        ttk.Button(move, text="Descendre", style="Tool.TButton", command=lambda: self.move_step(1)).grid(row=0, column=1)

        self.add_entry(panel, "Titre", self.step_vars["title"], 1, 0)
        self.add_combo(panel, "Type de tache", self.step_vars["type"], list(TYPE_LABELS.keys()), 2, 0)
        self.add_combo(panel, "Executeur / moteur", self.step_vars["executor"], [], 3, 0)
        self.executor_combo = panel.grid_slaves(row=3, column=0)[0].winfo_children()[1]
        self.add_combo(panel, "Mode d'action", self.step_vars["mode"], list(MODE_LABELS.keys()), 4, 0)
        self.build_step_help(panel, 5)
        self.active_step_label = ttk.Label(panel, text="Commande pour: -", style="Muted.TLabel")
        self.active_step_label.grid(row=6, column=0, sticky="w", pady=(4, 0))
        self.build_command_picker(panel, 7)
        self.add_combo(panel, "Commande", self.step_vars["command"], [], 8, 0, editable=True)
        self.command_combo = panel.grid_slaves(row=8, column=0)[0].winfo_children()[1]
        ttk.Button(panel, text="Executer la commande", style="Primary.TButton", command=self.execute_current_step).grid(row=9, column=0, sticky="ew", pady=(2, 8))

        prompt_head = ttk.Frame(panel, style="Panel.TFrame")
        prompt_head.grid(row=10, column=0, sticky="ew", pady=(6, 4))
        prompt_head.columnconfigure(0, weight=1)
        ttk.Label(prompt_head, text="PROMPT", style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(prompt_head, text="Exemple prompt", style="Tool.TButton", command=self.fill_prompt_example).grid(row=0, column=1, sticky="e")
        self.prompt_hint_label = ttk.Label(panel, text="", style="Muted.TLabel")
        self.prompt_hint_label.grid(row=11, column=0, sticky="ew", pady=(0, 4))
        self.prompt_text = tk.Text(panel, height=4, wrap="word", bg="#fafdff", fg=COLORS["text"], relief="solid", bd=1, highlightthickness=1, highlightcolor=COLORS["blue"])
        self.prompt_text.grid(row=12, column=0, sticky="ew")

        ttk.Label(panel, text="GARDE-FOU", style="Eyebrow.TLabel").grid(row=13, column=0, sticky="w", pady=(8, 4))
        self.guard_hint_label = ttk.Label(panel, text="", style="Muted.TLabel")
        self.guard_hint_label.grid(row=14, column=0, sticky="ew", pady=(0, 4))
        self.guard_text = tk.Text(panel, height=3, wrap="word", bg="#fafdff", fg=COLORS["text"], relief="solid", bd=1, highlightthickness=1, highlightcolor=COLORS["blue"])
        self.guard_text.grid(row=15, column=0, sticky="ew")

        self.add_entry(panel, "Sortie attendue", self.step_vars["output"], 16, 0)
        ttk.Button(panel, text="Retirer l'etape", style="Danger.TButton", command=self.delete_step).grid(row=17, column=0, sticky="ew", pady=(8, 0))

    def build_step_help(self, parent: ttk.Frame, row: int) -> None:
        self.step_help_frame = tk.Frame(parent, bg="#f1f7ff", highlightthickness=1, highlightbackground=COLORS["line"], padx=10, pady=8)
        self.step_help_frame.grid(row=row, column=0, sticky="ew", padx=(0, 8), pady=(0, 8))
        self.step_help_frame.columnconfigure(0, weight=1)
        ttk.Label(self.step_help_frame, text="AIDE RAPIDE", style="Eyebrow.TLabel", background="#f1f7ff").grid(row=0, column=0, sticky="w")
        self.step_help_title = tk.Label(self.step_help_frame, text="", bg="#f1f7ff", fg=COLORS["text"], font=("Segoe UI", 9, "bold"), anchor="w", justify="left")
        self.step_help_title.grid(row=1, column=0, sticky="ew", pady=(3, 2))
        self.step_help_body = tk.Label(self.step_help_frame, text="", bg="#f1f7ff", fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w", justify="left", wraplength=520)
        self.step_help_body.grid(row=2, column=0, sticky="ew")

    def build_log_panel(self, parent: ttk.Frame) -> None:
        panel = ttk.Frame(parent, style="Panel.TFrame", padding=12)
        panel.grid(row=3, column=0, sticky="ew", padx=16, pady=(0, 16))
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(2, weight=1)
        self.terminal_resize_handle = tk.Frame(panel, bg=COLORS["line"], height=6, cursor="sb_v_double_arrow")
        self.terminal_resize_handle.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.terminal_resize_handle.bind("<ButtonPress-1>", self.start_terminal_resize)
        self.terminal_resize_handle.bind("<B1-Motion>", self.drag_terminal_resize)
        self.terminal_resize_handle.bind("<ButtonRelease-1>", self.finish_terminal_resize)
        self.terminal_resize_handle.bind("<Enter>", lambda _event: self.highlight_terminal_resize(True))
        self.terminal_resize_handle.bind("<Leave>", lambda _event: self.highlight_terminal_resize(False))

        header = ttk.Frame(panel, style="Panel.TFrame")
        header.grid(row=1, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="TERMINAL", style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(header, text="Reduire", style="Tool.TButton", command=lambda: self.resize_terminal(-4)).grid(row=0, column=1, sticky="e", padx=(4, 0))
        ttk.Button(header, text="Agrandir", style="Tool.TButton", command=lambda: self.resize_terminal(4)).grid(row=0, column=2, sticky="e", padx=(4, 0))
        ttk.Button(header, text="Max", style="Tool.TButton", command=lambda: self.set_terminal_height(24)).grid(row=0, column=3, sticky="e", padx=(4, 0))
        ttk.Button(header, text="Min", style="Tool.TButton", command=lambda: self.set_terminal_height(5)).grid(row=0, column=4, sticky="e", padx=(4, 0))
        self.status_label = ttk.Label(header, text="Pret", style="Muted.TLabel")
        self.status_label.grid(row=0, column=5, sticky="e", padx=(12, 0))
        log_frame = ttk.Frame(panel, style="Panel.TFrame")
        log_frame.grid(row=2, column=0, sticky="nsew", pady=(8, 0))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log_text = tk.Text(log_frame, height=self.terminal_height, wrap="word", bg="#0f172a", fg="#e2e8f0", insertbackground="#e2e8f0", relief="flat")
        self.log_text.grid(row=0, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)
        self.log_text.configure(state="disabled")

    def add_entry(self, parent: ttk.Frame, label: str, variable: tk.StringVar, row: int, column: int, width: int = 18) -> None:
        wrapper = ttk.Frame(parent, style="Panel.TFrame")
        wrapper.grid(row=row, column=column, sticky="ew", padx=(0, 8), pady=(0, 8))
        wrapper.columnconfigure(0, weight=1)
        ttk.Label(wrapper, text=label, style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 4))
        ttk.Entry(wrapper, textvariable=variable, width=width).grid(row=1, column=0, sticky="ew")

    def add_combo(self, parent: ttk.Frame, label: str, variable: tk.StringVar, values: list[str], row: int, column: int, editable: bool = False) -> None:
        wrapper = ttk.Frame(parent, style="Panel.TFrame")
        wrapper.grid(row=row, column=column, sticky="ew", padx=(0, 8), pady=(0, 8))
        wrapper.columnconfigure(0, weight=1)
        ttk.Label(wrapper, text=label, style="Eyebrow.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 4))
        state = "normal" if editable else "readonly"
        ttk.Combobox(wrapper, textvariable=variable, values=values, state=state).grid(row=1, column=0, sticky="ew")

    def bind_events(self) -> None:
        self.workflow_tree.bind("<<TreeviewSelect>>", self.on_workflow_selected)
        for variable in self.workflow_vars.values():
            variable.trace_add("write", lambda *_args: self.update_workflow_from_form())
        for variable in self.step_vars.values():
            variable.trace_add("write", lambda *_args: self.update_step_from_form())
        self.objective_text.bind("<KeyRelease>", lambda _event: self.update_workflow_from_form())
        self.prompt_text.bind("<KeyRelease>", lambda _event: self.update_step_from_form())
        self.guard_text.bind("<KeyRelease>", lambda _event: self.update_step_from_form())
        self.command_filter_var.trace_add("write", lambda *_args: self.render_command_picker())
        self.command_category_var.trace_add("write", lambda *_args: self.render_command_picker())
        self.command_sort_var.trace_add("write", lambda *_args: self.render_command_picker())
        self.command_tree.bind("<Double-1>", lambda _event: self.use_selected_command())
        self.bind("<Control-s>", lambda _event: self.save_current_workflow())

    def update_shell_scroll_region(self, _event: tk.Event | None = None) -> None:
        if not hasattr(self, "shell_canvas"):
            return
        bbox = self.shell_canvas.bbox("all")
        if bbox:
            self.shell_canvas.configure(scrollregion=bbox)

    def resize_shell_window(self, event: tk.Event) -> None:
        if not hasattr(self, "shell_frame"):
            return
        width = max(int(event.width), self.shell_frame.winfo_reqwidth())
        height = max(int(event.height), self.shell_frame.winfo_reqheight())
        self.shell_canvas.itemconfigure(self.shell_window, width=width, height=height)
        self.update_shell_scroll_region()

    def scroll_shell_vertical(self, event: tk.Event) -> str:
        if int(getattr(event, "state", 0)) & 0x0001:
            return self.scroll_shell_horizontal(event)
        delta = int(getattr(event, "delta", 0))
        if delta:
            self.shell_canvas.yview_scroll(-1 * (delta // 120), "units")
        return "break"

    def scroll_shell_horizontal(self, event: tk.Event) -> str:
        delta = int(getattr(event, "delta", 0))
        if delta:
            self.shell_canvas.xview_scroll(-1 * (delta // 120), "units")
        return "break"

    def update_help_wrap(self, event: tk.Event) -> None:
        wrap = max(260, int(event.width) - 48)
        for label_name in ("step_help_body", "prompt_hint_label", "guard_hint_label"):
            if hasattr(self, label_name):
                getattr(self, label_name).configure(wraplength=wrap)

    def render_step_help(self) -> None:
        if not hasattr(self, "step_help_body"):
            return
        step_type = self.step_vars["type"].get() or "script"
        executor = self.step_vars["executor"].get() or executor_for_step_type(step_type)
        mode = self.step_vars["mode"].get() or default_mode_for_step_type(step_type)
        executor_label = self.executor_label(executor)
        self.step_help_title.configure(
            text=f"{TYPE_LABELS.get(step_type, step_type)} | {executor_label} | {MODE_LABELS.get(mode, mode)}"
        )
        self.step_help_body.configure(
            text="\n".join(
                [
                    f"Type: {TYPE_HELP.get(step_type, 'Nature de la tache dans le workflow.')}",
                    f"Executeur: {EXECUTOR_HELP.get(executor, 'Outil ou moteur qui prend cette etape en charge.')}",
                    f"Mode: {MODE_HELP.get(mode, 'Niveau de permission applique a cette etape.')}",
                ]
            )
        )
        self.prompt_hint_label.configure(text=PROMPT_HINTS.get(step_type, PROMPT_HINTS["script"]))
        self.guard_hint_label.configure(text=GUARD_HINTS.get(step_type, GUARD_HINTS["script"]))

    def executor_label(self, executor: str) -> str:
        metadata = (self.state.get("executors") or {}).get(executor, {})
        return metadata.get("label") or executor

    def fill_prompt_example(self) -> None:
        step_type = self.step_vars["type"].get() or "script"
        self.set_text(self.prompt_text, PROMPT_EXAMPLES.get(step_type, PROMPT_EXAMPLES["script"]))
        self.update_step_from_form()
        self.set_status("Exemple prompt ajoute")

    def render_all(self) -> None:
        self.is_rendering = True
        try:
            self.render_metrics()
            self.render_workflow_list()
            self.render_workflow_form()
            self.render_command_picker()
            self.render_step_board()
            self.render_step_editor()
        finally:
            self.is_rendering = False
        self.after_idle(self.update_shell_scroll_region)

    def render_metrics(self) -> None:
        for child in self.metrics_frame.winfo_children():
            child.destroy()
        workflow = self.current_workflow()
        metrics = [
            ("Workflows", len(self.workflows), COLORS["blue"]),
            ("Etapes", len(workflow.get("steps", [])) if workflow else 0, COLORS["orange"]),
            ("Projets", self.state.get("registry", {}).get("total", 0), COLORS["green"]),
        ]
        connectors = self.state.get("connectors", {})
        configured = sum(1 for connector in connectors.values() if connector.get("configured"))
        metrics.append(("Connecteurs", f"{configured}/{len(connectors)}", COLORS["purple"]))
        for index, (label, value, color) in enumerate(metrics):
            card = ttk.Frame(self.metrics_frame, style="Panel.TFrame", padding=12)
            card.grid(row=0, column=index, sticky="ew", padx=(0, 10 if index < 3 else 0))
            card.columnconfigure(0, weight=1)
            ttk.Label(card, text=label.upper(), style="Metric.TLabel").grid(row=0, column=0, sticky="w")
            value_label = ttk.Label(card, text=str(value), style="MetricValue.TLabel")
            value_label.configure(foreground=color)
            value_label.grid(row=1, column=0, sticky="w", pady=(4, 0))

    def render_workflow_list(self) -> None:
        for item in self.workflow_tree.get_children():
            self.workflow_tree.delete(item)
        for workflow in self.workflows:
            values = (STATUS_LABELS.get(workflow.get("status"), workflow.get("status", "")), len(workflow.get("steps", [])))
            self.workflow_tree.insert("", "end", iid=workflow["id"], text=workflow.get("name", "Workflow"), values=values)
        if self.selected_workflow_id:
            self.workflow_tree.selection_set(self.selected_workflow_id)

    def render_workflow_form(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        self.set_var(self.workflow_vars["name"], workflow.get("name", ""))
        self.set_var(self.workflow_vars["status"], workflow.get("status", "draft"))
        self.set_var(self.workflow_vars["owner"], workflow.get("owner", ""))
        self.set_var(self.workflow_vars["projectScope"], workflow.get("projectScope", ""))
        self.set_text(self.objective_text, workflow.get("objective", ""))

    def render_step_board(self) -> None:
        for child in self.step_container.winfo_children():
            child.destroy()
        workflow = self.current_workflow()
        steps = workflow.get("steps", []) if workflow else []
        if not steps:
            empty = ttk.Frame(self.step_container, style="Panel.TFrame", padding=24)
            empty.grid(row=0, column=0, sticky="ew")
            ttk.Label(empty, text="Ajoute une premiere etape pour demarrer ce workflow.", style="Muted.TLabel").grid(row=0, column=0, sticky="w")
            return
        for index, step in enumerate(steps):
            self.render_step_card(index, step)

    def render_step_card(self, index: int, step: dict) -> None:
        selected = step.get("id") == self.selected_step_id
        bg = COLORS["blue_soft"] if selected else "#ffffff"
        frame = tk.Frame(self.step_container, bg=bg, highlightthickness=1, highlightbackground=COLORS["blue"] if selected else COLORS["line"], padx=12, pady=10)
        frame.grid(row=index, column=0, sticky="ew", pady=(0, 8), padx=2)
        frame.columnconfigure(1, weight=1)
        index_label = tk.Label(frame, text=f"{index + 1:02d}", bg=bg, fg=COLORS["blue"], font=("Consolas", 11, "bold"), width=4)
        index_label.grid(row=0, column=0, rowspan=2, sticky="n", padx=(0, 10))
        title = tk.Label(frame, text=step.get("title", "Etape"), bg=bg, fg=COLORS["text"], font=("Segoe UI", 10, "bold"), anchor="w")
        title.grid(row=0, column=1, sticky="ew")
        detail = self.step_card_detail(step)
        detail_label = tk.Label(frame, text=detail, bg=bg, fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w", wraplength=600, justify="left")
        detail_label.grid(row=1, column=1, sticky="ew", pady=(3, 0))
        meta = tk.Label(frame, text=f"{TYPE_LABELS.get(step.get('type'), step.get('type'))}  |  {MODE_LABELS.get(step.get('mode'), step.get('mode'))}", bg=bg, fg=COLORS["purple"], font=("Consolas", 8), anchor="e")
        meta.grid(row=0, column=2, sticky="ne", padx=(10, 0))
        for widget in (frame, index_label, title, detail_label, meta):
            widget.bind("<Button-1>", lambda _event, step_id=step.get("id"): self.select_step(step_id))

    def render_step_editor(self) -> None:
        step = self.current_step()
        if not step:
            self.editor_title.configure(text="Aucune etape")
            if hasattr(self, "active_step_label"):
                self.active_step_label.configure(text="Commande pour: aucune etape selectionnee")
            return
        self.editor_title.configure(text=step.get("title", "Etape"))
        self.active_step_label.configure(text=f"Commande pour: {self.step_position_label(step)}")
        self.set_var(self.step_vars["title"], step.get("title", ""))
        self.set_var(self.step_vars["type"], step.get("type", "script"))
        self.update_executor_values()
        self.set_var(self.step_vars["executor"], step.get("executor", "script"))
        self.set_var(self.step_vars["mode"], step.get("mode", "dry-run"))
        self.command_combo.configure(values=[script["command"] for script in self.state.get("scripts", [])])
        self.set_var(self.step_vars["command"], step.get("command", ""))
        self.set_text(self.prompt_text, step.get("prompt", ""))
        self.set_text(self.guard_text, step.get("guard", ""))
        self.set_var(self.step_vars["output"], step.get("output", ""))
        self.render_step_help()

    def render_command_picker(self) -> None:
        if not hasattr(self, "command_tree"):
            return
        categories = ["Toutes", *sorted({self.command_category(script) for script in self.state.get("scripts", [])})]
        current_category = self.command_category_var.get() or "Toutes"
        self.command_category_combo.configure(values=categories)
        if current_category not in categories:
            self.command_category_var.set("Toutes")
            return

        query = self.command_filter_var.get().strip().lower()
        category = self.command_category_var.get()
        commands = [self.enrich_command(script) for script in self.state.get("scripts", [])]
        if category != "Toutes":
            commands = [script for script in commands if script["category"] == category]
        if query:
            commands = [
                script
                for script in commands
                if query in " ".join([script["name"], script["category"], script["description"], script["command"], script["raw"]]).lower()
            ]
        sort_mode = self.command_sort_var.get()
        if sort_mode == "Categorie":
            commands.sort(key=lambda script: (script["category"], script["name"]))
        elif sort_mode == "Explication":
            commands.sort(key=lambda script: script["description"])
        elif sort_mode == "Commande":
            commands.sort(key=lambda script: script["command"])
        else:
            commands.sort(key=lambda script: script["name"])

        self.visible_commands = commands
        for item in self.command_tree.get_children():
            self.command_tree.delete(item)
        for script in commands:
            self.command_tree.insert(
                "",
                "end",
                iid=script["name"],
                text=script["name"],
                values=(script["category"], script["description"], script["command"]),
            )
        self.command_count_label.configure(text=f"{len(commands)} commande(s)")

    def update_executor_values(self) -> None:
        values = list((self.state.get("executors") or {}).keys())
        self.executor_combo.configure(values=values)

    def on_workflow_selected(self, _event: tk.Event) -> None:
        if self.is_rendering:
            return
        selection = self.workflow_tree.selection()
        if not selection:
            return
        if selection[0] == self.selected_workflow_id:
            return
        self.selected_workflow_id = selection[0]
        workflow = self.current_workflow()
        self.selected_step_id = self.first_step_id(workflow)
        self.render_all()
        self.set_status("Selection")

    def select_step(self, step_id: str) -> None:
        self.selected_step_id = step_id
        was_rendering = self.is_rendering
        self.is_rendering = True
        try:
            self.render_step_board()
            self.render_step_editor()
        finally:
            self.is_rendering = was_rendering

    def update_workflow_from_form(self) -> None:
        if self.is_rendering:
            return
        workflow = self.current_workflow()
        if not workflow:
            return
        workflow["name"] = self.workflow_vars["name"].get().strip() or "Workflow sans nom"
        workflow["status"] = self.workflow_vars["status"].get()
        workflow["owner"] = self.workflow_vars["owner"].get()
        workflow["projectScope"] = self.workflow_vars["projectScope"].get()
        workflow["objective"] = self.get_text(self.objective_text)
        self.workflow_dirty = True
        self.set_status("Modifie")
        self.render_workflow_list()

    def update_step_from_form(self) -> None:
        if self.is_rendering:
            return
        step = self.current_step()
        if not step:
            return
        previous_type = step.get("type", "script")
        selected_type = self.step_vars["type"].get() or "script"
        if selected_type != previous_type:
            previous_guard = self.get_text(self.guard_text)
            was_rendering = self.is_rendering
            self.is_rendering = True
            try:
                self.update_executor_values()
                self.set_var(self.step_vars["executor"], executor_for_step_type(selected_type))
                self.set_var(self.step_vars["mode"], default_mode_for_step_type(selected_type))
                if selected_type == "script" and not self.step_vars["command"].get().strip():
                    self.set_var(self.step_vars["command"], "npm run safety:check")
                if selected_type != "script":
                    self.set_var(self.step_vars["command"], "")
                if not previous_guard or previous_guard == self.default_guard(previous_type):
                    self.set_text(self.guard_text, self.default_guard(selected_type))
            finally:
                self.is_rendering = was_rendering
        step["title"] = self.step_vars["title"].get().strip() or label_for_step_type(self.step_vars["type"].get())
        step["type"] = selected_type
        step["executor"] = self.step_vars["executor"].get() or executor_for_step_type(step["type"])
        step["mode"] = self.step_vars["mode"].get() or default_mode_for_step_type(step["type"])
        step["command"] = self.step_vars["command"].get()
        step["prompt"] = self.get_text(self.prompt_text)
        step["guard"] = self.get_text(self.guard_text)
        step["output"] = self.step_vars["output"].get()
        self.workflow_dirty = True
        self.set_status("Modifie")
        self.render_step_board()
        self.render_step_help()

    def add_step(self, step_type: str) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        step = {
            "id": new_id("step"),
            "type": step_type,
            "title": label_for_step_type(step_type),
            "executor": executor_for_step_type(step_type),
            "command": "npm run safety:check" if step_type == "script" else "",
            "mode": default_mode_for_step_type(step_type),
            "prompt": "Proposer une analyse bornee sans modifier les fichiers." if step_type in {"mistral", "qwen"} else "",
            "guard": self.default_guard(step_type),
            "output": "",
        }
        workflow.setdefault("steps", []).append(step)
        self.selected_step_id = step["id"]
        self.workflow_dirty = True
        self.render_all()
        self.set_status("Etape ajoutee")

    def use_selected_command(self) -> None:
        selection = self.command_tree.selection() if hasattr(self, "command_tree") else []
        if not selection:
            self.set_status("Choisir une commande")
            return
        command = next((item for item in self.visible_commands if item["name"] == selection[0]), None)
        if not command:
            return
        workflow = self.current_workflow()
        if not workflow:
            return
        step = self.current_step()
        if not step:
            messagebox.showwarning("Commande", "Selectionne une tache avant d'utiliser une commande.")
            return
        self.apply_command_to_step(step, command)
        self.workflow_dirty = True
        self.render_all()
        self.write_log(
            "Commande ajoutee uniquement a la tache selectionnee:\n"
            f"{self.step_position_label(step)}\n"
            f"{command['command']}"
        )
        self.set_status("Commande ajoutee")

    def create_new_workflow(self) -> None:
        result = create_workflow({"name": "Nouveau workflow desktop"})
        self.workflows = result["store"]["workflows"]
        self.selected_workflow_id = result["workflow"]["id"]
        self.selected_step_id = ""
        self.render_all()
        self.set_status("Cree")

    def save_current_workflow(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        result = save_workflow({"workflow": workflow})
        self.workflows = result["store"]["workflows"]
        self.workflow_dirty = False
        self.render_all()
        self.set_status("Sauve")
        self.write_log(f"Workflow sauvegarde:\n{WORKFLOWS_PATH}")

    def duplicate_current_workflow(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        result = duplicate_workflow(workflow["id"])
        self.workflows = result["store"]["workflows"]
        self.selected_workflow_id = result["workflow"]["id"]
        self.selected_step_id = self.first_step_id(result["workflow"])
        self.render_all()
        self.set_status("Duplique")

    def delete_current_workflow(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        if not messagebox.askyesno("Retirer le workflow", "Retirer ce workflow du studio local ?"):
            return
        try:
            result = delete_workflow(workflow["id"])
        except ValueError as error:
            messagebox.showwarning("Workflow", str(error))
            return
        self.workflows = result["store"]["workflows"]
        self.selected_workflow_id = self.workflows[0]["id"] if self.workflows else ""
        self.selected_step_id = self.first_step_id(self.current_workflow())
        self.render_all()
        self.set_status("Retire")

    def export_current_workflow(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        target = filedialog.asksaveasfilename(
            title="Exporter le workflow",
            initialfile=f"{workflow['id']}.json",
            defaultextension=".json",
            filetypes=[("JSON", "*.json")],
        )
        if not target:
            return
        Path(target).write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", "utf-8")
        self.set_status("Exporte")

    def run_dry_run(self) -> None:
        workflow = self.current_workflow()
        if not workflow:
            return
        result = dry_run_workflow({"workflow": workflow})
        lines = [
            result["workflowName"],
            f"Statut: {result['status']}",
            result["message"],
            "",
        ]
        for check in result.get("checks", []):
            lines.append(f"{check['index']}. {check['title']} [{check['status']}]")
            lines.append(f"   Type: {check['type']} | Executeur: {check['executor']}")
            for note in check.get("notes", []):
                lines.append(f"   - {note}")
        self.write_log("\n".join(lines))
        self.set_status(result["status"])

    def execute_current_step(self) -> None:
        if self.command_running:
            self.set_status("Execution deja active")
            return
        step = self.current_step()
        if not step:
            messagebox.showwarning("Execution", "Selectionne d'abord une etape.")
            return
        if step.get("type") != "script":
            messagebox.showwarning("Execution", "L'execution reelle est limitee aux etapes Script local.")
            return
        command = self.step_vars["command"].get().strip()
        parsed = self.parse_npm_command(command)
        if not parsed:
            messagebox.showwarning("Execution bloquee", "Seules les commandes du type npm run <script> sont autorisees.")
            return
        script_name, extra_args = parsed
        known_scripts = {script.get("name") for script in self.state.get("scripts", [])}
        if script_name not in known_scripts:
            messagebox.showwarning("Execution bloquee", f"Script npm inconnu: {script_name}")
            return
        if self.needs_real_action_confirmation(extra_args):
            ok = messagebox.askyesno(
                "Confirmer l'action reelle",
                "Cette commande contient un drapeau d'action reelle (--apply, --run ou --capture).\n\n"
                f"Commande:\n{command}\n\nLancer maintenant ?",
            )
            if not ok:
                self.set_status("Execution annulee")
                return
        self.command_running = True
        self.set_status("Execution")
        self.write_log(f"Execution en cours:\n{command}")
        thread = threading.Thread(target=self.run_npm_command_thread, args=(script_name, extra_args, command), daemon=True)
        thread.start()

    def run_npm_command_thread(self, script_name: str, extra_args: list[str], command: str) -> None:
        npm = "npm.cmd" if os.name == "nt" else "npm"
        try:
            result = subprocess.run(
                [npm, "run", script_name, *extra_args],
                cwd=ORCHESTRATOR_ROOT,
                capture_output=True,
                text=True,
                timeout=10 * 60,
                check=False,
            )
            summary = self.summarize_command_result(script_name, result.stdout)
            output = [
                summary,
                "",
                "DETAILS BRUTS",
                f"Commande: {command}",
                f"Exit: {result.returncode}",
                "",
                "STDOUT",
                result.stdout.strip() or "-",
                "",
                "STDERR",
                result.stderr.strip() or "-",
            ]
            status = "OK" if result.returncode == 0 else "Erreur"
            self.after(0, lambda: self.finish_command_execution(status, "\n".join(output)))
        except subprocess.TimeoutExpired:
            self.after(0, lambda: self.finish_command_execution("Timeout", f"Commande trop longue:\n{command}"))
        except Exception as error:
            self.after(0, lambda: self.finish_command_execution("Erreur", str(error)))

    def finish_command_execution(self, status: str, log: str) -> None:
        self.command_running = False
        self.set_status(status)
        self.write_log(log)

    def parse_npm_command(self, command: str) -> tuple[str, list[str]] | None:
        parts = command.strip().split()
        if len(parts) < 3:
            return None
        if parts[0].lower() != "npm" or parts[1].lower() != "run":
            return None
        script_name = parts[2]
        extra_args = parts[3:]
        return script_name, extra_args

    def needs_real_action_confirmation(self, args: list[str]) -> bool:
        return any(arg in {"--apply", "--run", "--capture"} for arg in args)

    def summarize_command_result(self, script_name: str, stdout: str) -> str:
        report_path = self.extract_stdout_value(stdout, "Rapport:")
        archive_value = self.extract_stdout_value(stdout, "Archive:")
        if script_name == "projects:inventory" and report_path:
            report_json = Path(report_path).with_suffix(".json")
            try:
                payload = json.loads(report_json.read_text("utf-8"))
                summary = payload.get("summary", {})
                diff = payload.get("diff", {})
                lines = [
                    "RESULTAT",
                    f"Mode: {payload.get('mode', '-')}",
                    f"Base de reference mise a jour: {'oui' if payload.get('mode') == 'apply' else 'non (dry-run)'}",
                    f"Projets detectes: {summary.get('total', 0)}",
                    f"Projet(s) precedent(s): {summary.get('previousTotal', 0)}",
                    f"Nouveau(x): {summary.get('newProjects', 0)}",
                    f"Absent(s): {summary.get('removedProjects', 0)}",
                    f"Deplace(s): {summary.get('movedProjects', 0)}",
                    f"Non inscrit(s) au registre: {summary.get('unregisteredProjects', 0)}",
                ]
                new_names = [item.get("name", "-") for item in diff.get("newProjects", [])]
                if new_names:
                    lines.append(f"Nouveaux projets: {', '.join(new_names[:8])}")
                if len(new_names) > 8:
                    lines.append(f"... et {len(new_names) - 8} autre(s)")
                if archive_value:
                    lines.append(f"Archive: {archive_value}")
                lines.append(f"Rapport: {report_path}")
                return "\n".join(lines)
            except Exception as error:
                return f"RESULTAT\nRapport genere: {report_path}\nLecture du resume impossible: {error}"
        if script_name == "projects:git-check" and report_path:
            report_json = Path(report_path).with_suffix(".json")
            try:
                payload = json.loads(report_json.read_text("utf-8"))
                summary = payload.get("summary", {})
                results = payload.get("results", [])
                without_git = [item.get("name", "-") for item in results if not item.get("git", {}).get("hasGit")]
                dirty = [item.get("name", "-") for item in results if item.get("git", {}).get("hasGit") and item.get("git", {}).get("dirty")]
                lines = [
                    "RESULTAT",
                    f"Projets scannes: {summary.get('total', 0)}",
                    f"Avec Git: {summary.get('withGit', 0)}",
                    f"Sans Git: {summary.get('withoutGit', 0)}",
                    f"Git dirty: {summary.get('dirty', 0)}",
                    f"Git clean: {summary.get('clean', 0)}",
                    f"Non inscrit(s) au registre: {summary.get('unregistered', 0)}",
                ]
                if without_git:
                    lines.append(f"Projets sans Git: {', '.join(without_git[:8])}")
                if len(without_git) > 8:
                    lines.append(f"... et {len(without_git) - 8} autre(s) sans Git")
                if dirty:
                    lines.append(f"Projets dirty: {', '.join(dirty[:8])}")
                if len(dirty) > 8:
                    lines.append(f"... et {len(dirty) - 8} autre(s) dirty")
                lines.append(f"Rapport: {report_path}")
                return "\n".join(lines)
            except Exception as error:
                return f"RESULTAT\nRapport genere: {report_path}\nLecture du resume Git impossible: {error}"
        if script_name == "projects:git-ensure" and report_path:
            report_json = Path(report_path).with_suffix(".json")
            try:
                payload = json.loads(report_json.read_text("utf-8"))
                summary = payload.get("summary", {})
                results = payload.get("results", [])
                to_init = [item.get("name", "-") for item in results if item.get("status") in {"WOULD_INIT", "INIT_DONE"}]
                lines = [
                    "RESULTAT",
                    f"Mode: {payload.get('mode', '-')}",
                    f"Projets scannes: {summary.get('total', 0)}",
                    f"Deja avec Git: {summary.get('alreadyWithGit', 0)}",
                    f"Git a creer: {summary.get('wouldInit', 0)}",
                    f"Git initialises: {summary.get('initialized', 0)}",
                    f"Erreurs: {summary.get('errors', 0)}",
                ]
                if to_init:
                    lines.append(f"Projets concernes: {', '.join(to_init[:8])}")
                if len(to_init) > 8:
                    lines.append(f"... et {len(to_init) - 8} autre(s)")
                lines.append(f"Rapport: {report_path}")
                return "\n".join(lines)
            except Exception as error:
                return f"RESULTAT\nRapport genere: {report_path}\nLecture du resume Git ensure impossible: {error}"
        if script_name == "projects:fiches-sync" and report_path:
            report_json = Path(report_path).with_suffix(".json")
            try:
                payload = json.loads(report_json.read_text("utf-8"))
                summary = payload.get("summary", {})
                results = payload.get("results", [])
                targets = [item.get("name", "-") for item in results if item.get("needsSync")]
                lines = [
                    "RESULTAT",
                    f"Mode: {payload.get('mode', '-')}",
                    f"Projets scannes: {summary.get('total', 0)}",
                    f"Git dirty: {summary.get('dirty', 0)}",
                    f"Fiches projet manquantes: {summary.get('missingProjectFiche', 0)}",
                    f"Fiches site manquantes: {summary.get('missingSiteFiche', 0)}",
                    f"Projets a synchroniser: {summary.get('needsSync', 0)}",
                    f"Projets appliques: {summary.get('applied', 0)}",
                    f"Erreurs: {summary.get('errors', 0)}",
                ]
                if targets:
                    lines.append(f"Projets concernes: {', '.join(targets[:8])}")
                if len(targets) > 8:
                    lines.append(f"... et {len(targets) - 8} autre(s)")
                lines.append(f"Rapport: {report_path}")
                return "\n".join(lines)
            except Exception as error:
                return f"RESULTAT\nRapport genere: {report_path}\nLecture du resume fiches impossible: {error}"
        if report_path:
            return f"RESULTAT\nCommande terminee.\nRapport: {report_path}"
        return "RESULTAT\nCommande terminee."

    def extract_stdout_value(self, stdout: str, prefix: str) -> str | None:
        for line in stdout.splitlines():
            if line.startswith(prefix):
                return line[len(prefix):].strip()
        return None

    def delete_step(self) -> None:
        workflow = self.current_workflow()
        if not workflow or not self.selected_step_id:
            return
        workflow["steps"] = [step for step in workflow.get("steps", []) if step.get("id") != self.selected_step_id]
        self.selected_step_id = self.first_step_id(workflow)
        self.workflow_dirty = True
        self.render_all()
        self.set_status("Etape retiree")

    def move_step(self, direction: int) -> None:
        workflow = self.current_workflow()
        steps = workflow.get("steps", []) if workflow else []
        index = next((idx for idx, step in enumerate(steps) if step.get("id") == self.selected_step_id), -1)
        target = index + direction
        if index < 0 or target < 0 or target >= len(steps):
            return
        steps[index], steps[target] = steps[target], steps[index]
        self.workflow_dirty = True
        self.render_step_board()
        self.set_status("Ordre modifie")

    def current_workflow(self) -> dict | None:
        return next((workflow for workflow in self.workflows if workflow.get("id") == self.selected_workflow_id), self.workflows[0] if self.workflows else None)

    def current_step(self) -> dict | None:
        workflow = self.current_workflow()
        if not workflow:
            return None
        return next((step for step in workflow.get("steps", []) if step.get("id") == self.selected_step_id), None)

    def step_position_label(self, step: dict) -> str:
        workflow = self.current_workflow()
        steps = workflow.get("steps", []) if workflow else []
        index = next((idx for idx, item in enumerate(steps) if item.get("id") == step.get("id")), -1)
        number = index + 1 if index >= 0 else "?"
        return f"#{number} - {step.get('title', 'Etape')}"

    def step_card_detail(self, step: dict) -> str:
        command = step.get("command", "").strip()
        guard = step.get("guard", "").strip()
        prompt = step.get("prompt", "").strip()
        if command:
            lines = [f"Commande: {command}"]
            if guard:
                lines.append(f"Garde-fou: {guard}")
            return "\n".join(lines)
        return guard or prompt or "A preciser"

    def first_step_id(self, workflow: dict | None) -> str:
        steps = workflow.get("steps", []) if workflow else []
        return steps[0].get("id", "") if steps else ""

    def set_status(self, value: str) -> None:
        suffix = " *" if self.workflow_dirty and value not in {"Sauve"} else ""
        self.status_label.configure(text=f"{value}{suffix}")

    def resize_terminal(self, delta: int) -> None:
        self.set_terminal_height(self.terminal_height + delta)

    def set_terminal_height(self, height: int) -> None:
        self.terminal_height = max(5, min(32, int(height)))
        self.log_text.configure(height=self.terminal_height)
        self.set_status(f"Terminal {self.terminal_height} lignes")
        self.after_idle(self.update_shell_scroll_region)

    def start_terminal_resize(self, event: tk.Event) -> None:
        self.terminal_dragging = True
        self.terminal_drag_start_y = int(event.y_root)
        self.terminal_drag_start_height = self.terminal_height
        self.highlight_terminal_resize(True)

    def drag_terminal_resize(self, event: tk.Event) -> None:
        if not self.terminal_dragging:
            return
        line_height = self.terminal_line_height()
        line_delta = round((self.terminal_drag_start_y - int(event.y_root)) / line_height)
        self.set_terminal_height(self.terminal_drag_start_height + line_delta)

    def finish_terminal_resize(self, _event: tk.Event) -> None:
        self.terminal_dragging = False
        self.highlight_terminal_resize(False)

    def highlight_terminal_resize(self, active: bool) -> None:
        if not hasattr(self, "terminal_resize_handle"):
            return
        if self.terminal_dragging:
            active = True
        self.terminal_resize_handle.configure(bg=COLORS["blue"] if active else COLORS["line"])

    def terminal_line_height(self) -> int:
        try:
            font = tkfont.nametofont(self.log_text.cget("font"))
        except tk.TclError:
            font = tkfont.Font(font=self.log_text.cget("font"))
        return max(12, font.metrics("linespace") + 2)

    def write_log(self, value: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.insert("1.0", value)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def set_var(self, variable: tk.StringVar, value: str) -> None:
        if variable.get() != value:
            variable.set(value)

    def set_text(self, widget: tk.Text, value: str) -> None:
        current = self.get_text(widget)
        if current == value:
            return
        widget.delete("1.0", "end")
        widget.insert("1.0", value)

    def get_text(self, widget: tk.Text) -> str:
        return widget.get("1.0", "end").strip()

    def default_guard(self, step_type: str) -> str:
        return {
            "script": "Scan/dry-run avant toute modification",
            "mistral": "Aucun secret envoye; contexte minimal seulement",
            "qwen": "Aucun secret envoye; aucune modification directe",
            "gate": "Validation Yann avant action sensible",
            "note": "Memoire projet apres evolution utile",
        }.get(step_type, "")

    def apply_command_to_step(self, step: dict, command: dict) -> None:
        step["type"] = "script"
        step["executor"] = "script"
        step["mode"] = "dry-run"
        step["command"] = command["command"]
        if not step.get("title") or step.get("title", "").startswith("Etape "):
            step["title"] = self.command_title(command["name"])
        if not step.get("guard"):
            step["guard"] = "Dry-run avant execution reelle"

    def enrich_command(self, script: dict) -> dict:
        category = self.command_category(script)
        return {
            **script,
            "category": category,
            "description": self.command_description(script, category),
        }

    def command_description(self, script: dict, category: str) -> str:
        name = script.get("name", "")
        if name in COMMAND_EXPLANATIONS:
            return COMMAND_EXPLANATIONS[name]
        fallback = {
            "Inventaire": "Controle ou met a jour les informations de projet.",
            "Controle": "Verifie une regle de securite, documentation ou publication.",
            "Git/Backup": "Prepare ou controle les changements Git et sauvegardes.",
            "Hub": "Met a jour ou controle le hub Site Ma Methode.",
            "IA": "Lance ou controle une action avec sous-agent IA.",
            "Memoire/Runtime": "Synchronise la memoire, les skills ou les agents.",
            "Routines": "Lance une routine planifiee de l'orchestrateur.",
            "Maintenance": "Aide a nettoyer, reparer ou ameliorer les projets.",
        }
        return fallback.get(category, "Commande locale disponible dans package.json.")

    def command_category(self, script: dict) -> str:
        name = script.get("name", "")
        raw = script.get("raw", "")
        haystack = f"{name} {raw}".lower()
        if name in {"scan", "projects:inventory", "registry:check", "status:check", "expected:check", "detect:stack"}:
            return "Inventaire"
        if any(token in haystack for token in ["security", "safety", "audit", "publication", "hostinger", "docs:check", "site:check", "screenshots:check"]):
            return "Controle"
        if any(token in haystack for token in ["github", "git:", "git-", "backup"]):
            return "Git/Backup"
        if any(token in haystack for token in ["site-ma-methode", "site:render", "thumbnails", "site "]):
            return "Hub"
        if any(token in haystack for token in ["subagent", "mistral", "qwen"]):
            return "IA"
        if any(token in haystack for token in ["memory", "skills", "agents"]):
            return "Memoire/Runtime"
        if name in {"daily", "weekly", "monthly", "dashboard"}:
            return "Routines"
        if any(token in haystack for token in ["cleanup", "archive", "functionality", "repair", "fiches", "optimization", "architecture"]):
            return "Maintenance"
        return "Autres"

    def command_title(self, name: str) -> str:
        special = {
            "projects:inventory": "Inventaire projets",
            "scan": "Scan projets",
            "safety:check": "Controle dry-run",
            "security": "Audit securite",
        }
        if name in special:
            return special[name]
        return name.replace(":", " ").replace("-", " ").strip().title()


def main() -> None:
    app = WorkflowStudio()
    app.mainloop()


if __name__ == "__main__":
    main()
