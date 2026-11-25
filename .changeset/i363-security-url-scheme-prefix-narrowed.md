---
'@noctcore/eslint-plugin-security': patch
---

`no-user-controlled-redirect` and `no-user-controlled-fetch-url` no longer report a runtime value after relative text that no scheme leaving the origin or running script starts with. `` res.redirect(`page${x}`) ``, `` res.redirect(`users${id}`) `` and `` fetch(`api${x}`) `` were reported since the scheme prefix change and now pass. Text that can still grow into such a scheme (`h`, `java`, `dat`, `vb`, `ws`, `fil`, in any case) is still reported. Removed reports: a relative prefix made only of scheme characters that is not the start of http, https, ws, wss, ftp, ftps, sftp, file, data, blob, filesystem, javascript, vbscript, livescript, view-source, jar, intent, gopher, ldap, ldaps, dict, tftp, telnet or smb.
