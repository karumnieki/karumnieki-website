# Working rules for an AI assistant in this repo

Read `HANDOVER.md` first: it is how the site works, what is decided and how it is tested.

- Change both pages in the same edit (`site/index.html` and `site/en/index.html`), then run `npm test` and report
  its result, failures included.
- Start the preview with `python3 tools/serve.py 8477` (Windows: `python tools\serve.py 8477`) and give the link
  http://localhost:8477/site/ (and /site/en/) so the change can be checked in a browser.
- No em or en dashes anywhere: copy, code comments, files. Use a plain hyphen or rephrase. Write Latvian with its
  diacritics.
- Never invent photo content, reviews, numbers or prices. The owner's decisions in HANDOVER.md section 5.1 change
  only with his yes.
- Never put a secret, a token, a password or an account ID into this repo: it is public.
- Ask a maintainer before anything that leaves this folder or cannot be undone: deploying, DNS, creating accounts,
  sending a message or an e-mail, anything that reaches the owner, pushing to GitHub.
- Do not run `tools/fetch-fonts.py` (it erases the fallback fonts); the photo tools need `photos/`, which is not here.
