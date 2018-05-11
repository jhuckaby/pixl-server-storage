// Generated automatically by nearley
// http://github.com/Hardmath123/nearley
(function () {
function id(x) {return x[0]; }


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

var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "main$subexpression$1", "symbols": ["expression"]},
    {"name": "main$subexpression$1", "symbols": ["group"]},
    {"name": "main", "symbols": ["_", "main$subexpression$1", "_"], "postprocess": function(d) { return d[1][0]; }},
    {"name": "group$subexpression$1", "symbols": ["expression"]},
    {"name": "group$subexpression$1", "symbols": ["group"]},
    {"name": "group$ebnf$1", "symbols": []},
    {"name": "group$ebnf$1$subexpression$1$subexpression$1", "symbols": ["expression"]},
    {"name": "group$ebnf$1$subexpression$1$subexpression$1", "symbols": ["group"]},
    {"name": "group$ebnf$1$subexpression$1", "symbols": ["_", (lexer.has("separator") ? {type: "separator"} : separator), "_", "group$ebnf$1$subexpression$1$subexpression$1"]},
    {"name": "group$ebnf$1", "symbols": ["group$ebnf$1", "group$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "group", "symbols": [{"literal":"("}, "_", "group$subexpression$1", "group$ebnf$1", "_", {"literal":")"}], "postprocess": extractGroup},
    {"name": "expression", "symbols": [(lexer.has("column") ? {type: "column"} : column), "_", (lexer.has("operator") ? {type: "operator"} : operator), "_", "value"], "postprocess": extractExpression},
    {"name": "value", "symbols": ["number"], "postprocess": id},
    {"name": "value", "symbols": ["string"], "postprocess": id},
    {"name": "number", "symbols": [(lexer.has("number") ? {type: "number"} : number)], "postprocess": function(d) { return { type: 'number', value: parseFloat(d[0].value) }; }},
    {"name": "string", "symbols": [(lexer.has("string") ? {type: "string"} : string)], "postprocess": function(d) { return { type: 'string', value: JSON.parse(d[0].value) }; }},
    {"name": "_", "symbols": []},
    {"name": "_", "symbols": [(lexer.has("space") ? {type: "space"} : space)], "postprocess": function(d) { return null; }}
]
  , ParserStart: "main"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
