Repo for the Peritext rich text CRDT.

Includes the CRDT code and a UI demo.

To run:

`npm install`
`npm run start`

## To output interactive demo for the essay

`npx parcel build src/essay-demo.ts`

Copy the resulting file to the essay repo:

`cp ./dist/essay-demo.js <Insert Essays Repo Path>/content/peritext/static/peritext-demo.js`

Also copy over any CSS changes to the essay repo under `content/peritext/static/peritext-styles.css` if needed.
