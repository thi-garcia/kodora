#!/usr/bin/env bash
set -euo pipefail

# Config padrão (pode sobrescrever via env/flags)
UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
ORIGIN_REMOTE="${ORIGIN_REMOTE:-origin}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
BOLT_BRANCH="${BOLT_BRANCH:-bolt-main}"

NO_VERIFY_FLAG="--no-verify"
PUSH=0
DO_COMMIT=0
COMMIT_MSG="chore(sync): local changes"
MODE="pick"        # pick = cherry-pick sem conflitos | merge | rebase
DRY_RUN=0

usage() {
  cat <<EOF
Uso: bash scripts/sync-upstream.sh [opções]

  --commit [msg]   Adiciona todas as mudanças e cria commit local (--no-verify)
                   (se msg omitida -> "chore(sync): local changes")
  --push           Dá push da main (e opcionalmente da bolt-main) no origin
  --merge          Em vez de cherry-pick, faz merge de bolt-main -> main
  --rebase         Em vez de cherry-pick, faz rebase da main sobre bolt-main
  --dry-run        Só simula (lista o que faria), não aplica
  --no-verify      Mantém (padrão) --no-verify nos commits/pushes
  --verify         Remove --no-verify
  -h | --help      Ajuda

Ambiente:
  UPSTREAM_REMOTE=upstream  UPSTREAM_BRANCH=main
  ORIGIN_REMOTE=origin      MAIN_BRANCH=main    BOLT_BRANCH=bolt-main
EOF
}

# ---- parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      DO_COMMIT=1
      if [[ "${2-}" != "" && "${2-}" != --* ]]; then COMMIT_MSG="$2"; shift; fi
      ;;
    --push)  PUSH=1 ;;
    --merge) MODE="merge" ;;
    --rebase) MODE="rebase" ;;
    --dry-run) DRY_RUN=1 ;;
    --no-verify) NO_VERIFY_FLAG="--no-verify" ;;
    --verify) NO_VERIFY_FLAG="" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opção desconhecida: $1"; usage; exit 1 ;;
  esac
  shift || true
done

git rev-parse --is-inside-work-tree >/dev/null || { echo "❌ Não é um repositório Git."; exit 1; }

current_branch="$(git branch --show-current || true)"
[[ -z "$current_branch" ]] && current_branch="$MAIN_BRANCH"

echo "🏁 Remotos: origin=$ORIGIN_REMOTE | upstream=$UPSTREAM_REMOTE"
echo "🏁 Branches: main=$MAIN_BRANCH | bolt=$BOLT_BRANCH (espelha $UPSTREAM_REMOTE/$UPSTREAM_BRANCH)"
echo "🏁 Modo: $MODE | dry-run: $DRY_RUN"

# 1) commit local se pedido
if [[ $DO_COMMIT -eq 1 ]]; then
  git add -A
  if ! git diff --cached --quiet; then
    echo "📝 Commitando mudanças locais..."
    HUSKY=0 git commit -m "$COMMIT_MSG" $NO_VERIFY_FLAG || true
  else
    echo "ℹ️  Nada staged para commitar."
  fi
fi

# 2) fetch remotos
git fetch "$ORIGIN_REMOTE" || true
git fetch "$UPSTREAM_REMOTE"

# 3) atualizar/crear bolt-main a partir do upstream/main
if git show-ref --verify --quiet "refs/heads/$BOLT_BRANCH"; then
  git checkout "$BOLT_BRANCH"
  git reset --hard "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
else
  git checkout -B "$BOLT_BRANCH" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
fi

# 4) voltar à main
git checkout "$MAIN_BRANCH"

if [[ "$MODE" == "merge" ]]; then
  echo "🔀 MERGE bolt-main -> main"
  if [[ $DRY_RUN -eq 1 ]]; then
    git diff --stat "$MAIN_BRANCH...$BOLT_BRANCH"
    echo "💡 Dry-run: merge não aplicado."
    exit 0
  fi
  if ! git merge --no-ff "$BOLT_BRANCH"; then
    echo "⛔ Conflitos no merge. Abortando para não afetar suas mudanças."
    git merge --abort || true
    exit 2
  fi

elif [[ "$MODE" == "rebase" ]]; then
  echo "🔁 REBASE main sobre bolt-main"
  if [[ $DRY_RUN -eq 1 ]]; then
    git log --oneline --graph --decorate --boundary "$(git merge-base $MAIN_BRANCH $BOLT_BRANCH)..$MAIN_BRANCH"
    echo "💡 Dry-run: rebase não aplicado."
    exit 0
  fi
  if ! git rebase "$BOLT_BRANCH"; then
    echo "⛔ Conflitos no rebase. Abortando para não afetar suas mudanças."
    git rebase --abort || true
    exit 2
  fi

else
  echo "🍒 CHERRY-PICK seletivo (apenas commits sem conflito)"
  base="$(git merge-base "$MAIN_BRANCH" "$BOLT_BRANCH")"
  mapfile -t commits < <(git rev-list --reverse "$base..$BOLT_BRANCH")

  ts="$(date +%Y%m%d-%H%M%S)"
  report="scripts/sync-report-$ts.md"
  echo "# Sync upstream report ($ts)" > "$report"
  echo "" >> "$report"
  echo "- Base: \`$base\`" >> "$report"
  echo "- Upstream: \`$UPSTREAM_REMOTE/$UPSTREAM_BRANCH\`" >> "$report"
  echo "- Commits no range: ${#commits[@]}" >> "$report"
  echo "" >> "$report"

  applied=0; skipped=0
  for c in "${commits[@]}"; do
    subj="$(git log --format=%s -n 1 "$c")"
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "- would pick $c  $subj" >> "$report"
      continue
    fi
    if git cherry-pick -x "$c"; then
      echo "- ✅ $c  $subj" >> "$report"
      ((applied++))
    else
      git cherry-pick --abort || true
      echo "- ⛔ (conflict) $c  $subj" >> "$report"
      ((skipped++))
    fi
  done
  echo "" >> "$report"
  echo "**Applied:** $applied  |  **Skipped (conflict):** $skipped" >> "$report"

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "💡 Dry-run: nada aplicado. Relatório em $report"
    exit 0
  fi

  git add "$report" || true
  if ! git diff --cached --quiet; then
    HUSKY=0 git commit -m "chore(sync): add upstream sync report" $NO_VERIFY_FLAG || true
  fi
fi

# 5) push se pedido
if [[ $PUSH -eq 1 ]]; then
  echo "⬆️  Push main -> origin"
  git push "$ORIGIN_REMOTE" "$MAIN_BRANCH" $NO_VERIFY_FLAG
  # manter bolt-main no origin pode ajudar a comparar no GitHub (opcional)
  if git show-ref --verify --quiet "refs/remotes/$ORIGIN_REMOTE/$BOLT_BRANCH"; then
    echo "⬆️  Push bolt-main -> origin (opcional)"
    git push "$ORIGIN_REMOTE" "$BOLT_BRANCH" $NO_VERIFY_FLAG || true
  fi
fi

git checkout "$current_branch" >/dev/null 2>&1 || true
echo "✅ Sync concluído."
