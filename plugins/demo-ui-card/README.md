# demo-ui-card

Frontend + backend demo in one plugin:

- **Backend** `main.py`: registers the `demo_ui_card` tool, which returns JSON carrying `octop_ui`
- **Frontend** `ui/dist/index.js`: renders a card in chat and demonstrates L2 refreshes with `host.patchResult`

Install:

```bash
octop plugin install ./plugins/demo-ui-card --force
```

Then enable `demo_ui_card` for an Agent in the Dashboard's "Tool management" and call the tool in chat to see the card.
