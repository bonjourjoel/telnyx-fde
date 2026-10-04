# Test the voice FAQ

Deploy the step 12 workflow:

```powershell
npm.cmd run deploy
```

Use the Portal voice test. With existing tickets, choose a new question. Without
tickets, ask the question after the greeting. No fixture preparation is required.

Try "How do dynamic variables work?" or "How do Stateful Actors store data?"

- Expect the documentation title, goodbye and automatic hangup.
- There is no offer of a detailed explanation and no yes/no response to provide.
- Try an unclear question: expect brief clarification only when needed.
- Try an unrelated question: expect the not-covered message and hangup.

MCP/tool failure must produce the unavailable message, not a claim that no page
covers the question. Native tool availability still needs the actual Portal test.

Voice logs should show `list_topics` and `read_short_answer` with a discovered
topic id. Transcripts should show `faq_short`, `goodbye`, then the terminal
`hangup` Tool node. The public MCP still exposes three tools; `read_long_answer`
is tested separately by `scripts/check-mcp.ts` and is not used by this voice flow.
