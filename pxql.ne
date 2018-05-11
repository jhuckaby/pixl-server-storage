# PxQL (pixl-query-language)
# Grammar Source for Nearley
# Compile: nearleyc pxql.ne > pxql.js
# Copyright (c) 2017 PixlCore.com and Joseph Huckaby
# MIT Licensed

@{%

// PxQL (pixl-query-language)
// Copyright (c) 2017 PixlCore.com and Joseph Huckaby
// MIT Licensed

const moo = require('moo');

let lexer = moo.compile({
	space: {match: /\s+/, lineBreaks: true},
	column: {match: /[A-Za-z]\w*/, lineBreaks: false},
	operator: {match: /=~|\!~|<=|<|>=|>|==|=/, lineBreaks: false},
	separator: {match: /\&\&?|\|\|?/, lineBreaks: false},
	number: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\b/,
	string: /"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/,
	'(': '(',
	')': ')',
	true: 'true',
	false: 'false',
	null: 'null',
});

%}

@lexer lexer

main -> _ (expression | group) _ {% function(d) { return d[1][0]; } %}

group -> "(" _ (expression | group) (_ %separator _ (expression | group)):* _ ")" {% extractGroup %}

expression -> %column _ %operator _ value {% extractExpression %}

value ->
	number {% id %}
	| string {% id %}

number -> %number {% function(d) { return { type: 'number', value: parseFloat(d[0].value) }; } %}

string -> %string {% function(d) { return { type: 'string', value: JSON.parse(d[0].value) }; } %}

_ -> null | %space {% function(d) { return null; } %}

@{%

function extractGroup(d) {
	let output = [d[2][0]];
	let mode = '';
	
	for (let i in d[3]) {
		if (d[3][i][1].type == 'separator') {
			if (mode && (d[3][i][1].value != mode)) throw new Error("Ambiguous logic operator: " + d[3][i][1].value + " (use parenthesis to group)");
			mode = d[3][i][1].value;
		}
		output.push(d[3][i][3][0]);
	}
	
	if (mode.match(/\|/)) mode = 'or';
	else mode = 'and';
	
	if (output.length == 1) return output[0];
	else return { mode: mode, criteria: output };
}

function extractExpression(d) {
	var obj = { index: d[0].value, operator: d[2].value, word: ''+d[4].value };
	
	if ((obj.operator == '=~') || (obj.operator == '==') || (obj.operator == '=')) {
		// default operator
		delete obj.operator;
	}
	else if (obj.operator == '!~') {
		// negative word match
		obj.negative = 1;
		delete obj.operator;
	}
	
	return obj;
}

%}

