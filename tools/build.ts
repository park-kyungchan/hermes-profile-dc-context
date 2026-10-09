export {};
const result = await Bun.build({entrypoints:['./src/index.ts'],outdir:'./dist',target:'bun'});
if(!result.success){console.error(result.logs);process.exit(1);}
console.log('Built', result.outputs.length, 'artifact(s)');
