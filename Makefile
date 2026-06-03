# Global Macro Dashboard — dev orchestration (zero extra deps)
#
#   make setup     one-time: create venv + install backend & frontend deps
#   make backend   run FastAPI on :8000
#   make frontend  run Vite on :5173
#   make dev       run BOTH (Ctrl-C stops both)

SHELL := /bin/bash
PY := python3
VENV := backend/venv
PYBIN := $(VENV)/bin

.PHONY: setup backend frontend dev clean

setup:
	@echo ">> creating venv + installing backend deps"
	cd backend && $(PY) -m venv venv && ./venv/bin/pip install --upgrade pip -q && ./venv/bin/pip install -q -r requirements.txt
	@echo ">> copying .env.example -> .env (if missing)"
	@test -f backend/.env || cp backend/.env.example backend/.env
	@echo ">> installing frontend deps"
	cd frontend && npm install
	@echo ">> setup complete. Run 'make dev'."

backend:
	cd backend && ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload

frontend:
	cd frontend && npm run dev

dev:
	@echo ">> starting backend (:8000) and frontend (:5173). Ctrl-C to stop both."
	@trap 'kill 0' EXIT INT TERM; \
	( cd backend && ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload ) & \
	( cd frontend && npm run dev ) & \
	wait

clean:
	rm -rf backend/venv frontend/node_modules frontend/dist
