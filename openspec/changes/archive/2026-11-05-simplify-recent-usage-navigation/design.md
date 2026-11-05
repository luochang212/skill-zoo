# Design

Reuse the existing tray navigation event and pending-navigation guard. Add a usage-dialog request alongside the existing companion-manager request, so the destination opens on repeated navigation. Append the View usage menu footer after every recent-data state, with a copy hint only when records exist. Remove source suffixes from the title and empty label.

Extend the Local scrolling row through the existing right padding and put that padding inside the scrolling content; apply the same layout to the skeleton. No new platform APIs or dependencies are needed.
