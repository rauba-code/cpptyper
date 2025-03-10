// const repl = require('node:repl');
//const process = require('node:process');
// const { Buffer } = require('node:buffer');

const message: string = "Hello, world!";
console.log(message);

process.on('SIGINT', () => {
    console.log('Received SIGINT. Press Control-D to exit.');
});

const term = {
    "TTYPE": null,
    "FUNCTION": null,
    "VOID": null,
    "NULLPTR": null,
    "LREF": null,
    "ARRAY": null,
    "CLASS": null,
    "MEMBER": null,
    "PTR": null,
    "I8": null,
    "U8": null,
    "I16": null,
    "U16": null,
    "I32": null,
    "U32": null,
    "I64": null,
    "U64": null,
    "F32": null,
    "F64": null,
    "BOOL": null,
    "STRINGLITERAL": null,
    "CHARLITERAL": null,
    "INTLITERAL": null,
    "FLOATLITERAL": null,
    "END": null
} as const;
type Term = keyof (typeof term);

const nonTerm = {
    "TemplateParamPlus": null,
    "TemplateParamOrEnd": null,
    "FunctionParamPlus": null,
    "FunctionParamOrEnd": null,
    "Member": null,
    "Function": null,
    "Type": null,
    "Object": null,
    "ParamObject": null,
    "Parametric": null,
    "LRef": null,
    "LValue": null,
    "Pointer": null,
    "Pointee": null,
    "Array": null,
    "ArraySize": null,
    "Class": null,
    "Arithmetic": null,
    "Literal": null,
    "ObjectOrFunction": null,
    "Return": null
} as const;
type NonTerm = keyof (typeof nonTerm);

const specTerm = {
    "identifier": null,
    "positiveint": null,
}
type SpecTerm = keyof (typeof specTerm);

type LexSym = Term | NonTerm | SpecTerm;

const typeBNF: { [symbol: string]: LexSym[][] } = {
    "Type": [["Object", "VOID", "Function", "LRef"]],
    "Object": [["ParamObject", "Array"]],
    "ParamObject": [["Class", "Arithmetic", "NULLPTR", "Pointer", "Member"]],
    "Parametric": [["ParamObject", "LRef"]],
    "Member": [["MEMBER"], ["Class"], ["Class"]],
    "LRef": [["LREF"], ["LValue"]],
    "LValue": [["Object", "Function"]],
    "Pointee": [["LValue", "VOID"]],
    "Pointer": [["PTR"], ["Pointee"]],
    "Array": [["ARRAY"], ["Object"], ["ArraySize"]],
    "ArraySize": [["positiveint"]],
    "Class": [["CLASS"], ["identifier"], ["TemplateParamOrEnd"]],
    "Arithmetic": [["I8", "U8", "I16", "U16", "I32", "U32", "I64", "U64", "F32", "F64", "BOOL"]],
    "Function": [["FUNCTION"], ["Return"], ["FunctionParamOrEnd"]],
    "FunctionParamOrEnd": [["FunctionParamPlus", "END"]],
    "FunctionParamPlus": [["Parametric"], ["FunctionParamOrEnd"]],
    "TemplateParamOrEnd": [["TemplateParamPlus", "END"]],
    "TemplateParamPlus": [["Parametric"], ["TemplateParamOrEnd"]],
    "Return": [["Parametric", "VOID"]]
};

type Parser = { [symbol: string]: { [startsWith: string]: NonTerm | SpecTerm | null }[] }

console.time("create_parser")
function constructTypeParser(): Parser {
    let result: Parser = {};
    Object.keys(typeBNF).forEach((key: string) => {
        result[key] = new Array();
        typeBNF[key].forEach((union: LexSym[], fieldIdx: number) => {
            result[key].push({});
            union.forEach((element: LexSym) => {
                if (element in term || element in specTerm) {
                    result[key][fieldIdx][element] = null;
                }
            })
        })
        result[key][0][key as NonTerm] = null;
    })
    let i = 0;
    while (true) {
        let dirty: boolean = false;
        Object.keys(typeBNF).forEach((key: string) => {
            typeBNF[key].forEach((union: LexSym[], fieldIdx: number) => {
                union.forEach((nterm: LexSym) => {
                    if (nterm in nonTerm) {
                        if (!(nterm in result)) {
                            throw new Error(`NonTerm ${nterm} is outside the grammar tree`);
                        }
                        Object.keys(result[nterm][0]).forEach((startsWith) => {
                            if (!(startsWith in result[key][fieldIdx])) {
                                result[key][fieldIdx][startsWith] = nterm as NonTerm;
                                dirty = true;
                            }
                        })
                    }
                })
            })
        })
        if (!dirty) {
            break;
        }
        i++;
        if (i > 1000) {
            throw new Error("Perpetual loop detected")
        }
    }

    return result;
}
const typeParser = constructTypeParser();
console.timeEnd("create_parser");
console.log(typeParser);

interface ParsedLemma {
    ok: boolean,
    result: string[],
    sentence: string[]
}

const wildcardDeclarator: string = '!';
const wildcardSpecifier: string = '?';

function preparse(sentence: string[], strict_order: boolean = true): string[] {
    let targets: string[] = new Array();
    while (sentence.length > 0 && sentence[0].startsWith(wildcardDeclarator)) {
        targets.push(sentence[0].slice(1));
        sentence = sentence.slice(1);
    }
    if (targets.length === 0) {
        return sentence;
    }
    let expectedMaxId: number = 0;
    return sentence.map((x: string) => {
        if (x.startsWith(wildcardSpecifier)) {
            const wildcardId : number = parseInt(x.slice(1));
            if (!(wildcardId >= 0 && wildcardId < targets.length)) {
                throw new Error(`Wildcard ${x} is out of bounds`);
            }
            if (strict_order && expectedMaxId < wildcardId) {
                throw new Error(`Wildcard ${x} precedes ?${expectedMaxId}`);
            }
            if (wildcardId === expectedMaxId) {
                expectedMaxId++;
            }
            return targets[wildcardId];
        } else {
            return x;
        }
    });
}

function parse(parser: Parser, scope: NonTerm, sentence: string[]): ParsedLemma {
    let result: string[] = ["(", scope];
    let ok: boolean = true;
    let endLoop: boolean = false;
    parser[scope].forEach((argument) => {
        if (!ok || endLoop) {
            return;
        }
        if (sentence.length > 0 && sentence[0] in argument) {
            const innerScope: NonTerm | null = argument[sentence[0]] as NonTerm | null;
            if (innerScope === null) {
                if (sentence[0] === scope) {
                    endLoop = true;
                } else {
                    result.push(sentence[0]);
                }
                sentence = sentence.slice(1);
            } else {
                const parseResult = parse(parser, innerScope as NonTerm, sentence);
                result = result.concat(parseResult.result);
                sentence = parseResult.sentence;
                ok = parseResult.ok;
            }
        } else if (sentence.length > 0 && "identifier" in argument) {
            result.push(sentence[0]);
            sentence = sentence.slice(1);
        } else if (sentence.length > 0 && "positiveint" in argument) {
            if (!(parseInt(sentence[0]) > 0)) {
                result.push("{Expected positive integer}");
                ok = false;
                sentence = [];
            } else {
                result.push(sentence[0]);
                sentence = sentence.slice(1);
            }
        } else {
            result.push("{Expected " + scope + "}");
            ok = false;
            sentence = [];
        }
    });
    result.push(")");
    return { ok, result, sentence };
}

function execCommand(command: string[]): void {
    const commands: { [key: string]: (params: string[]) => void } = {
        "PARSE": (params: string[]) => {
            console.time("command");
            const parseResult = parse(typeParser, "Type", preparse(params));
            console.timeEnd("command");
            console.log("ok: " + parseResult.ok);
            console.log(parseResult.result.join(" "));
        },
        "ECHO": (params: string[]) => {
            console.log(params);
        },
        "EXIT": (_: string[]) => {
            process.exit(0);
        }
    }
    if (command.length == 0) {
        return;
    }
    const cmdName: string = command[0];
    const params: string[] = command.slice(1);
    if (cmdName in commands) {
        commands[cmdName](params);
    } else {
        console.log("Available commands: ")
        console.log("  " + Object.keys(commands).join(", "))
    }
}

process.stdin.on('readable', () => {
    let chunk: Buffer;
    while (null !== (chunk = process.stdin.read())) {
        const chunkStr: string = chunk.toString("utf8").trim();
        execCommand(chunkStr.split(' '));
    }
})
