const fs = require('fs');
const https = require('https');
const path = require('path');
const glob = require('glob');
const cssmin = require('cssmin');
const uglify = require('uglify-js');
const { styleNames } = require('./alias');

// minify all css files
let cssTask = Promise.all(
	glob.sync('Highlight/scripts/styles/*.css', {absolute: true}).map( (filepath) => {
		return new Promise( (resolve, reject) => {
			fs.readFile(filepath, {encoding: 'utf8'}, (err, data) => {
				if (err) return reject(err);

				let filename = path.basename(filepath, '.css');
				let newPath = filepath.replace(/\.css$/, '.min.css');
				let style = styleNames[ filename ] || filename.replace(/(?:^|[._-])([a-zA-Z0-9])/g, ($0, $1) => ' ' + $1.toUpperCase() ).trim();

				fs.unlink(filepath, () => {});
				fs.writeFile( newPath, cssmin(data), (err) => {
					if (err) return reject(err);
					resolve({filename, style});
				} );
			} );
		} );
	} )
)
.then( (names) => {
	console.log('✨  Successfully minified css files.');

	return (
		'public let hlStyles:[String: String] = [\n' +
		names.map( ({filename, style}) => `\t"${style}": "${filename}",\n` ).join('') +
		']'
	);
} )
.catch( err => {
	console.log(err);
} );

// 
let jsTask = Promise.all(
	glob.sync('node_modules/highlight.js/lib/languages/+([a-zA-Z0-9_-]).js', {absolute: true}).map( (filepath) => {
		return new Promise( (resolve, reject) => {
			fs.readFile(filepath, {encoding: 'utf8'}, (err, data) => {
				if (err) return reject(err);

				let filename = path.basename(filepath, '.js');
				data = '(function() {' + data + '})();'
				data = data.replace(/module.exports\s*=\s*(\w+)/, `highlightGlobalInstance.registerLanguage('${filename}', $1)`)

				resolve( { lang: filename, data } );
			} );
		} );
	} )
)
.then( (langs) => {
	let hljs = fs.readFileSync('node_modules/highlight.js/lib/core.js', {encoding: 'utf8'});

	hljs = hljs.replace(/module.exports\s*=\s*(\w+);/, `var highlightGlobalInstance = highlight;`)

	// load the order of registration
	let order = (fs.readFileSync('node_modules/highlight.js/lib/index.js')+"")
		.match(/'[\w-]+(?=')/g)
		.map( s => s.substring(1) );

	langs.sort( (a, b) => order.indexOf(a.lang) - order.indexOf(b.lang) );
	hljs += langs.map( ({data}) => data ).join('');

	console.log('⏱  Compiling the Highlight package file...');

	return new Promise( (resolve, reject) => {
		const code = hljs;
		//const code = uglify.minify(hljs, { sourceMap: false, mangle: false }).code;

		fs.writeFile('Highlight/scripts/highlight.pack.js', code, (err) => {
			if (err) return reject(err);

			console.log('✨  Successfully generated highlight.pack.js');

			resolve(`public let hlLangCount: UInt16 = ${langs.length}`);
		} );
	} );
} )
.catch( err => {
	console.log(err);
} );

// Language name map
let mapTask = new Promise( (resolve, reject) => {
	https.get( 'https://highlightjs.org/download/', (res) => {
		var html = '';
		var map = [];

		res.on('data', data => { html += data; } );
		res.on('end', () => {
			let regex = /name="([\w-]+).js"(?: checked)?>([^<>]+)<\/label>/g, match;
			while (match = regex.exec(html) ) {
				map.push( `\t"${match[2].trim()}": "${match[1]}",\n` );
			}
			resolve(
				'public let hlLanguages:[String: String] = [\n' +
				map.join('') +
				']'
			);
		});
	})
	.on('error', (e) => reject(e) );
} )
.catch( err => {
	console.log(err);
} );

// Generate the constant file.
Promise.all( [ jsTask, cssTask, mapTask ] ).then( ([lang, style, langMap]) => {
	fs.writeFile(
		'Highlight/Constant.swift',
		`
//
// Constant.swift
// Highlight
//
// This file is automatically generated.
// DO NOT MODIFY THIS FILE MANUALLY
//

${lang}

${langMap}

${style}
		`.trim() + '\n',
		() => {}
	)
} );
