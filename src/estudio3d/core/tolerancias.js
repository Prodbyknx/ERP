// Tolerâncias da malha — UMA definição, usada pelo laudo (validador) e pelo
// conserto (reparo). Antes o conserto soldava vértices 10× mais longe do que
// o laudo considerava "repetido": o Consertar dizia "soldou N vértices" numa
// malha que o laudo dava como perfeita (auditoria A5).
// diag = diagonal da caixa da peça (mm).

// dois vértices a menos que isso são o mesmo ponto
export const tolSolda = diag => Math.max(1e-6, diag * 1e-6);

// triângulo com área menor que isso é degenerado (mm²)
export const tolAreaDegenerada = diag => Math.max(1e-12, diag * diag * 1e-14);

// região fina menor que isso (mm²) é ruído de malha (uma face dobrada, uma
// lasca), não parede fina de verdade — não entra em "Regiões críticas" nem
// na "Espessura mínima" (auditoria A6)
export const AREA_MINIMA_REGIAO_FINA = 0.1;
