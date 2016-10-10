//////////////////////////////////////////////////////////////////////////////////////
//
//  Copyright (c) 2014-present, Egret Technology.
//  All rights reserved.
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Egret nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
//  THIS SOFTWARE IS PROVIDED BY EGRET AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//  OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
//  IN NO EVENT SHALL EGRET AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;LOSS OF USE, DATA,
//  OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
//  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
//////////////////////////////////////////////////////////////////////////////////////

import * as ts from "typescript";

let checker:ts.TypeChecker;
let files:ts.SourceFile[];
let dependencyMap:{[key:string]:string[]};
let pathWeightMap:{[key:string]:number};

export interface Result {
    sortedFiles:ts.SourceFile[],
    circularReferences:string[]
}

export function sortFiles(sourceFiles:ts.SourceFile[], typeChecker:ts.TypeChecker):Result {
    files = sourceFiles.concat();
    checker = typeChecker;
    buildDependencyMap();
    let result = sortOnDependency();
    files = null;
    checker = null;
    dependencyMap = null;
    return result;
}

function createMap():any {
    let obj:any = Object.create(null);
    obj.__v8__ = undefined;
    delete obj.__v8__;
    return obj;
}

function addDependency(file:string, dependent:string):void {
    if (file == dependent) {
        return;
    }
    let list = dependencyMap[file];
    if (!list) {
        list = dependencyMap[file] = [];
    }
    if (list.indexOf(dependent) == -1) {
        list.push(dependent);
    }
}

function buildDependencyMap():void {
    dependencyMap = createMap();
    for (let i = 0; i < files.length; i++) {
        let sourceFile = files[i];
        if (sourceFile.isDeclarationFile) {
            continue;
        }
        visitFile(sourceFile);
    }
}

function visitFile(sourceFile:ts.SourceFile):void {
    let statements = sourceFile.statements;
    let length = statements.length;
    for (let i = 0; i < length; i++) {
        let statement = statements[i];
        if (statement.flags & ts.NodeFlags.Ambient) { // has the 'declare' keyword
            continue;
        }
        if (statement.kind === ts.SyntaxKind.ExpressionStatement) {
            let expression = <ts.ExpressionStatement>statement;
            checkExpression(expression.expression);
        }
        else if (statement.kind === ts.SyntaxKind.ImportEqualsDeclaration) {
            let importDeclaration = <ts.ImportEqualsDeclaration>statement;
            if (importDeclaration.moduleReference.kind == ts.SyntaxKind.QualifiedName) {
                let qualifiedName = <ts.QualifiedName>importDeclaration.moduleReference;
                checkDependencyAtLocation(qualifiedName);
            }
        }
        else {
            visitStatement(statements[i]);
        }
    }
}

function visitStatement(statement:ts.Statement):void {
    switch (statement.kind) {
        case ts.SyntaxKind.ClassDeclaration:
            checkInheriting(<ts.ClassDeclaration>statement);
            checkStaticMember(<ts.ClassDeclaration>statement);
            break;
        case ts.SyntaxKind.VariableStatement:
            let variable = <ts.VariableStatement>statement;
            variable.declarationList.declarations.forEach(declaration=> {
                checkExpression(declaration.initializer);
            });
            break;
        case ts.SyntaxKind.ModuleDeclaration:
            visitModule(<ts.ModuleDeclaration>statement);
            break;
    }
}

function visitModule(node:ts.ModuleDeclaration):void {
    if (node.body.kind == ts.SyntaxKind.ModuleDeclaration) {
        visitModule(<ts.ModuleDeclaration>node.body);
        return;
    }
    let statements = (<ts.ModuleBlock>node.body).statements;
    let length = statements.length;
    for (let i = 0; i < length; i++) {
        let statement = statements[i];
        if (statement.flags & ts.NodeFlags.Ambient) { // has the 'declare' keyword
            continue;
        }
        visitStatement(statement);
    }
}

function checkDependencyAtLocation(node:ts.Node):void {
    let type = checker.getTypeAtLocation(node);
    if (!type || !type.symbol || type.flags & ts.TypeFlags.Interface) {
        return;
    }
    let sourceFile = type.symbol.valueDeclaration.getSourceFile();
    if (sourceFile.isDeclarationFile) {
        return;
    }
    addDependency(node.getSourceFile().fileName, sourceFile.fileName);
}

function checkInheriting(node:ts.ClassDeclaration):void {
    if (!node.heritageClauses) {
        return;
    }
    let heritageClause:ts.HeritageClause = null;
    for (const clause of node.heritageClauses) {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            heritageClause = clause;
            break;
        }
    }
    if (!heritageClause) {
        return;
    }
    let superClasses = heritageClause.types;
    if (!superClasses) {
        return;
    }
    let currentFileName = node.getSourceFile().fileName;
    superClasses.forEach(superClass=> {
        checkDependencyAtLocation(superClass);
    });
}

function checkStaticMember(node:ts.ClassDeclaration):void {
    let members = node.members;
    if (!members) {
        return;
    }
    for (let member of members) {
        if (!(member.flags & ts.NodeFlags.Static)) {
            continue;
        }
        if (member.kind == ts.SyntaxKind.PropertyDeclaration) {
            let property = <ts.PropertyDeclaration>member;
            checkExpression(property.initializer);
        }
    }
}

function checkExpression(expression:ts.Expression):void {
    if (!expression) {
        return;
    }
    switch (expression.kind) {
        case ts.SyntaxKind.NewExpression:
            checkNewExpression(expression);
            break;
        case ts.SyntaxKind.CallExpression:
            checkCallExpression(<ts.CallExpression>expression);
            break;
        case ts.SyntaxKind.Identifier:
        case ts.SyntaxKind.PropertyAccessExpression:
            checkDependencyAtLocation(expression);
            break;
        case ts.SyntaxKind.ArrayLiteralExpression:
            let arrayLiteral = <ts.ArrayLiteralExpression>expression;
            arrayLiteral.elements.forEach(checkExpression);
            break;
        case ts.SyntaxKind.TemplateExpression:
            let template = <ts.TemplateExpression>expression;
            template.templateSpans.forEach(span=> {
                checkExpression(span.expression);
            });
            break;
        case ts.SyntaxKind.ParenthesizedExpression:
            let parenthesized = <ts.ParenthesizedExpression>expression;
            checkExpression(parenthesized.expression);
            break;
        case ts.SyntaxKind.BinaryExpression:
            let binary = <ts.BinaryExpression>expression;
            checkExpression(binary.left);
            checkExpression(binary.right);
            break;
        case ts.SyntaxKind.PostfixUnaryExpression:
        case ts.SyntaxKind.PrefixUnaryExpression:
            checkExpression((<ts.PrefixUnaryExpression>expression).operand);
            break;
        case ts.SyntaxKind.DeleteExpression:
            checkExpression((<ts.DeleteExpression>expression).expression);

    }

    // ObjectLiteralExpression
    // ElementAccessExpression
    // TaggedTemplateExpression
    // TypeAssertionExpression
    // FunctionExpression
    // ArrowFunction
    // TypeOfExpression
    // VoidExpression
    // AwaitExpression
    // ConditionalExpression
    // YieldExpression
    // SpreadElementExpression
    // ClassExpression
    // OmittedExpression
    // ExpressionWithTypeArguments
    // AsExpression
    // NonNullExpression
}

function checkCallExpression(callExpression:ts.CallExpression):void {
    callExpression.arguments.forEach(argument=> {
        checkExpression(argument);
    });
    let expression = callExpression.expression;
    switch (expression.kind) {
        case ts.SyntaxKind.FunctionExpression:
            let functionExpression = <ts.FunctionExpression>expression;
            checkFunctionBody(functionExpression.body);
            break;
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.Identifier:
            let type = checker.getTypeAtLocation(expression);
            if (!type || !type.symbol || type.flags & ts.TypeFlags.Interface) {
                return;
            }
            let declaration = type.symbol.valueDeclaration;
            let sourceFile = declaration.getSourceFile();
            if (sourceFile.isDeclarationFile) {
                return;
            }
            addDependency(expression.getSourceFile().fileName, sourceFile.fileName);
            if (declaration.kind === ts.SyntaxKind.FunctionDeclaration ||
                declaration.kind === ts.SyntaxKind.MethodDeclaration) {
                checkFunctionBody((<ts.FunctionDeclaration>declaration).body);
            }
            break;
    }

}

function checkNewExpression(expression:ts.Expression):void {
    let type = checker.getTypeAtLocation(expression);
    if (!type || !type.symbol || type.flags & ts.TypeFlags.Interface) {
        return;
    }
    let declaration = type.symbol.valueDeclaration;
    let sourceFile = declaration.getSourceFile();
    if (sourceFile.isDeclarationFile) {
        return;
    }
    addDependency(expression.getSourceFile().fileName, sourceFile.fileName);
    if (declaration.kind === ts.SyntaxKind.ClassDeclaration) {
        checkClassInstantiation(<ts.ClassDeclaration>declaration);
    }
}

function checkClassInstantiation(node:ts.ClassDeclaration):void {
    let members = node.members;
    if (!members) {
        return;
    }
    for (let member of members) {
        if (member.flags & ts.NodeFlags.Static) {
            continue;
        }
        if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
            let property = <ts.PropertyDeclaration>member;
            checkExpression(property.initializer);
        }
        else if (member.kind === ts.SyntaxKind.Constructor) {
            let constructor = <ts.ConstructorDeclaration>member;
            checkFunctionBody(constructor.body);
        }
    }
}

function checkFunctionBody(body:ts.FunctionBody):void {
    ts.forEachChild(body, visit);
    function visit(node:ts.Node) {
        if (node.kind === ts.SyntaxKind.VariableStatement) {
            let variable = <ts.VariableStatement>node;
            variable.declarationList.declarations.forEach(declaration=> {
                checkExpression(declaration.initializer);
            });
        }
        else if (node.kind === ts.SyntaxKind.ExpressionStatement) {
            let expression = <ts.ExpressionStatement>node;
            checkExpression(expression.expression);
        }
        else {
            ts.forEachChild(node, visit);
        }

    }
}


function sortOnDependency():Result {
    let result:Result = <any>{};
    result.sortedFiles = files;
    result.circularReferences = [];
    pathWeightMap = createMap();
    for (let i = 0; i < files.length; i++) {
        let sourceFile = files[i];
        if (sourceFile.isDeclarationFile) {
            continue;
        }
        let path = sourceFile.fileName;
        let references = updatePathWeight(path, 0, [path]);
        if (references) {
            result.circularReferences = references;
            break;
        }
    }
    if (result.circularReferences.length === 0) {
        files.sort(function (a:ts.SourceFile, b:ts.SourceFile):number {
            return pathWeightMap[b.fileName] - pathWeightMap[a.fileName];
        });
    }
    pathWeightMap = null;
    return result;
}

function updatePathWeight(path:string, weight:number, references:string[]):string[] {
    if (pathWeightMap[path] === undefined) {
        pathWeightMap[path] = weight;
    }
    else {
        if (pathWeightMap[path] < weight) {
            pathWeightMap[path] = weight;
        }
        else {
            return null;
        }
    }
    let list = dependencyMap[path];
    if (!list) {
        return null;
    }
    for (let parentPath of list) {
        if (references.indexOf(parentPath) != -1) {
            references.push(parentPath);
            return references;
        }
        let result = updatePathWeight(parentPath, weight + 1, references.concat(parentPath));
        if (result) {
            return result;
        }
    }
    return null;
}