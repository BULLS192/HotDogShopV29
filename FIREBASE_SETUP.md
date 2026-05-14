Firebase production notes

This build is already configured for the Firebase project:
- camarillo-darts---hot-dog-shop

Before publishing:
1. Open Firebase Console -> Firestore Database and confirm the database exists.
2. Publish firestore.rules if you want to use the included starter rules.
3. Deploy the site to GitHub Pages or Firebase Hosting.
4. If you later enable Firebase Authentication, add your live domain to Authorized domains.

Collections used by the app:
- appState/currentTournament
- appState/playerDatabase
- seriesSeasons/hotdogshop-2026
- tournaments/{archiveId}
