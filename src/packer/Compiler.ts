//////////////////////////////////////////////////////////////////////////////////////
//
//  The MIT License (MIT)
//
//  Copyright (c) 2015-present, Dom Chen.
//  All rights reserved.
//
//  Permission is hereby granted, free of charge, to any person obtaining a copy of
//  this software and associated documentation files (the "Software"), to deal in the
//  Software without restriction, including without limitation the rights to use, copy,
//  modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
//  and to permit persons to whom the Software is furnished to do so, subject to the
//  following conditions:
//
//      The above copyright notice and this permission notice shall be included in all
//      copies or substantial portions of the Software.
//
//  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//  PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//  HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
//  OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
//  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
//////////////////////////////////////////////////////////////////////////////////////

import * as ts from "typescript-plus";
import * as config from "./Config";
import * as sorting from "./Sorting";
import * as utils from "./Utils";

export function emitModule(moduleConfig:config.ModuleConfig, compilerOptions:ts.CompilerOptions, errors:string[]):string[] {
    compilerOptions.outFile = moduleConfig.outFile;
    compilerOptions.declaration = moduleConfig.declaration;
    let fileNames = moduleConfig.fileNames;
    let program = ts.createProgram(fileNames, compilerOptions);

    let sortedFileNames:string[] = [];
    if (fileNames.length > 1) {
        let sortResult = sorting.sortFiles(program.getSourceFiles(), program.getTypeChecker())
        if (sortResult.circularReferences.length > 0) {
            ts.sys.write("error: circular references in '" + moduleConfig.name + "' :" + ts.sys.newLine);
            ts.sys.write("    at " + sortResult.circularReferences.join(ts.sys.newLine + "    at ") +
                ts.sys.newLine + "    at ..." + ts.sys.newLine);
            ts.sys.exit(1);
            return;
        }
        // apply the sorting result.
        let sourceFiles = program.getSourceFiles();
        let rootFileNames = program.getRootFileNames();
        sourceFiles.length = 0;
        rootFileNames.length = 0;
        sortResult.sortedFiles.forEach(sourceFile=> {
            sourceFiles.push(sourceFile);
            rootFileNames.push(sourceFile.fileName);
            if (!sourceFile.isDeclarationFile) {
                sortedFileNames.push(sourceFile.fileName);
            }
        });
    }
    else if (fileNames.length == 1) {
        let sourceFile = program.getSourceFile(fileNames[0]);
        if (!sourceFile.isDeclarationFile) {
            sortedFileNames.push(sourceFile.fileName);
        }
    }

    let emitResult = program.emit();
    let diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    if (diagnostics.length > 0) {
        diagnostics.forEach(diagnostic => {
            errors.push(utils.formatDiagnostics([diagnostic]));
        });
    }
    return sortedFileNames;
}