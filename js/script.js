"use strict";

const ALFABETO_ES = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

const BASE_ORDEN = { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U" };

function aCaracteres(texto) {
  // Array.from separa por punto de código (no por unidad UTF-16).
  return Array.from(texto);
}

/**
 * Normaliza el texto antes de cifrar o descifrar.
 *  - NFC: une "o" + tilde combinante en "ó" (mismo texto, un solo carácter).
 *  - Saltos de línea CRLF → LF (archivos de Windows).
 *  - Mayúsculas con reglas del español (ñ → Ñ, á → Á).
 *  - Si conservarSignos es falso, se dejan solo letras y dígitos
 *    (las letras acentuadas y la Ñ siguen siendo letras y se conservan).
 */
function normalizarTexto(texto, conservarSignos) {
  let t = texto.normalize("NFC").replace(/\r\n?/g, "\n").toLocaleUpperCase("es");
  if (!conservarSignos) {
    t = aCaracteres(t).filter(c => /[\p{L}\p{N}]/u.test(c)).join("");
  }
  return t;
}

/** Normaliza la clave y devuelve sus caracteres o un error legible. */
function validarClave(claveCruda) {
  const clave = claveCruda.normalize("NFC").trim().toLocaleUpperCase("es");
  if (clave.length === 0) return { error: "Ingrese una clave." };
  const letras = aCaracteres(clave);
  const invalidos = [];
  for (const c of letras) {
    const base = BASE_ORDEN[c] || c;
    if (!ALFABETO_ES.includes(base) && !invalidos.includes(c)) invalidos.push(c);
  }
  if (invalidos.length) {
    const lista = invalidos.map(c => (c === " " ? "espacio" : `«${c}»`)).join(", ");
    return {
      error: `La clave contiene caracteres no válidos: ${lista}. ` +
             "Use solo letras del alfabeto español (A–Z, Ñ, vocales con tilde o Ü), sin espacios, números ni signos."
    };
  }
  return { clave, letras };
}

/* ---------------------------------------------------------------------
   Paso 1 — Numeración de la clave
   --------------------------------------------------------------------- */

/**
 * Devuelve, para cada posición de la clave, su número de orden (1..N).
 * CONVENIENCE → [1, 10, 7, 11, 3, 8, 6, 4, 9, 2, 5]
 */
function generarOrdenClave(letras) {
  const indices = letras.map((_, i) => i);
  indices.sort((a, b) => {
    const pa = ALFABETO_ES.indexOf(BASE_ORDEN[letras[a]] || letras[a]);
    const pb = ALFABETO_ES.indexOf(BASE_ORDEN[letras[b]] || letras[b]);
    return pa - pb || a - b; // empate: gana la que está más a la izquierda
  });
  const numeros = new Array(letras.length);
  indices.forEach((col, rango) => { numeros[col] = rango + 1; });
  return numeros;
}

/* ---------------------------------------------------------------------
   Paso 2 — Forma de la matriz interrumpida
   --------------------------------------------------------------------- */

/**
 * Longitud de la línea r (0-based): la línea k (k = 1..N) llega hasta la
 * columna cuyo número es k, inclusive. Cuando se agotan las N líneas el
 * patrón vuelve a empezar (línea N+1 se comporta como la línea 1).
 */
function longitudLinea(r, numeros) {
  const k = (r % numeros.length) + 1;
  return numeros.indexOf(k) + 1;
}

/**
 * Coloca el texto en la matriz interrumpida, fila por fila.
 * Cada fila tiene N celdas; las celdas después del límite de la línea
 * quedan como hueco (null). Nunca se agrega relleno: si el texto se acaba,
 * el resto de la última línea también queda vacío.
 */
function construirMatrizInterrumpida(chars, numeros) {
  const N = numeros.length;
  const filas = [];
  let pos = 0, r = 0;
  while (pos < chars.length) {
    const limite = longitudLinea(r, numeros);
    const celdas = new Array(N).fill(null);
    for (let c = 0; c < limite && pos < chars.length; c++) celdas[c] = chars[pos++];
    filas.push({ celdas, limite, linea: (r % N) + 1, bloque: Math.floor(r / N) });
    r++;
  }
  return filas;
}

/* ---------------------------------------------------------------------
   Paso 3 — Lectura por columnas según la clave, ignorando huecos
   --------------------------------------------------------------------- */

function leerColumnas(matriz, numeros) {
  const lecturas = [];
  for (let k = 1; k <= numeros.length; k++) {
    const col = numeros.indexOf(k);
    const caracteres = [];
    for (const fila of matriz) {
      const ch = fila.celdas[col];
      if (ch !== null) caracteres.push(ch); // los huecos se saltan
    }
    lecturas.push({ numero: k, columna: col, caracteres });
  }
  return { texto: lecturas.map(l => l.caracteres.join("")).join(""), lecturas };
}

/* ---------------------------------------------------------------------
   Cifrado completo
   --------------------------------------------------------------------- */

function cifrarTransposicionInterrumpida(texto, letrasClave) {
  const numeros = generarOrdenClave(letrasClave);
  const matriz = construirMatrizInterrumpida(aCaracteres(texto), numeros);
  const { texto: cifrado, lecturas } = leerColumnas(matriz, numeros);
  return { numeros, matriz, lecturas, resultado: cifrado };
}

/* ---------------------------------------------------------------------
   Descifrado (inverso exacto de la misma estructura)
   1. Con la longitud del criptograma se reconstruye qué celdas estaban
      ocupadas (misma forma interrumpida, mismo final incompleto).
   2. Se rellenan las columnas en el orden de la clave, de arriba abajo,
      saltando huecos.
   3. Se lee la matriz fila por fila.
   --------------------------------------------------------------------- */

/*
function descifrarTransposicionInterrumpida(cifrado, letrasClave) {
  const numeros = generarOrdenClave(letrasClave);
  const chars = aCaracteres(cifrado);
  // Forma: misma matriz, con un marcador en cada celda ocupada.
  const forma = construirMatrizInterrumpida(new Array(chars.length).fill(true), numeros);
  const matriz = forma.map(f => ({ ...f, celdas: f.celdas.map(() => null) }));
  let pos = 0;
  const lecturas = [];
  for (let k = 1; k <= numeros.length; k++) {
    const col = numeros.indexOf(k);
    const caracteres = [];
    for (let r = 0; r < forma.length; r++) {
      if (forma[r].celdas[col] !== null) {
        matriz[r].celdas[col] = chars[pos];
        caracteres.push(chars[pos]);
        pos++;
      }
    }
    lecturas.push({ numero: k, columna: col, caracteres });
  }
  const plano = matriz.map(f => f.celdas.filter(c => c !== null).join("")).join("");
  return { numeros, matriz, lecturas, resultado: plano };
}
*/

/* =====================================================================
   INTERFAZ — estado, entrada, archivo, validación, render y descarga
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- Estado de la aplicación ---------- */
  const estado = {
    modo: null,          // "cifrar" | "descifrar"
    resultado: "",
    detalle: null,       // { numeros, matriz, lecturas, resultado }
    letrasClave: null,
    textoNormalizado: ""
  };

  const $ = id => document.getElementById(id);
  const el = {
    entrada: $("entrada"), salida: $("salida"), clave: $("clave"), conservar: $("conservar"),
    archivo: $("archivo"), nombreArchivo: $("nombreArchivo"), status: $("status"),
    cntEntrada: $("cntEntrada"), cntSalida: $("cntSalida"), lblEntrada: $("lblEntrada"), lblSalida: $("lblSalida"),
    btnCifrar: $("btnCifrar"), btnDescifrar: $("btnDescifrar"), btnDescargar: $("btnDescargar"),
    btnUsar: $("btnUsar")
  };

  /* ---------- Utilidades de presentación ---------- */
  const contar = t => Array.from(t).length;
  const plural = n => n === 1 ? "1 carácter" : `${n.toLocaleString("es")} caracteres`;
  function visible(ch) {
    if (ch === " ") return "␣";
    if (ch === "\n") return "↵";
    if (ch === "\t") return "⇥";
    return ch;
  }
  function h(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of hijos) if (c != null) n.append(c);
    return n;
  }
  function mensaje(tipo, texto) {
    el.status.replaceChildren();
    if (texto) el.status.append(h("div", { class: "msg " + tipo, text: texto }));
  }
  function actualizarContadores() {
    el.cntEntrada.textContent = plural(contar(el.entrada.value));
    el.cntSalida.textContent = el.salida.value ? plural(contar(el.salida.value)) : "—";
  }

  /* ---------- Validación ---------- */
  function validarEntradas() {
    if (el.entrada.value.length === 0 || el.entrada.value.trim().length === 0) {
      return { error: "Ingrese un texto para cifrar." };
    }
    const v = validarClave(el.clave.value);
    if (v.error) return v;
    const texto = normalizarTexto(el.entrada.value, el.conservar.checked);
    if (texto.length === 0) {
      return { error: "Después de quitar espacios y signos no queda ningún carácter. Active \"Conservar espacios y signos\"." };
    }
    return { texto, letras: v.letras, clave: v.clave };
  }

  /* ---------- Acciones ---------- */
  function ejecutar(modo) {
    const v = validarEntradas();
    if (v.error) {
      mensaje("error", modo === "descifrar" ? v.error.replace("para cifrar", "para descifrar") : v.error);
      if (/clave/i.test(v.error)) el.clave.focus(); else el.entrada.focus();
      return;
    }
    const det = modo === "cifrar"
      ? cifrarTransposicionInterrumpida(v.texto, v.letras)
      : descifrarTransposicionInterrumpida(v.texto, v.letras);

    Object.assign(estado, { modo, resultado: det.resultado, detalle: det, letrasClave: v.letras, textoNormalizado: v.texto });

    el.salida.value = det.resultado;
    el.lblSalida.textContent = modo === "cifrar" ? "Texto cifrado" : "Texto descifrado";
    el.btnDescargar.disabled = false;
    el.btnUsar.disabled = false;
    actualizarContadores();
    mensaje("ok", modo === "cifrar"
      ? `Texto cifrado: ${plural(contar(det.resultado))} transpuestos con la clave ${v.clave}.`
      : `Texto descifrado: ${plural(contar(det.resultado))} reubicados con la clave ${v.clave}.`);
  }

  function usarResultado() {
    if (!estado.resultado) return;
    el.entrada.value = estado.resultado;
    el.lblEntrada.textContent = estado.modo === "cifrar" ? "Texto cifrado (entrada)" : "Texto plano";
    el.entrada.placeholder = "Escriba aquí el texto que desea cifrar...";
    actualizarContadores();
    mensaje("info", estado.modo === "cifrar"
      ? "El texto cifrado está ahora en la entrada. Presione Descifrar con la misma clave para recuperar el mensaje."
      : "El texto descifrado está ahora en la entrada.");
  }

  /* ---------- Carga de archivo .txt (UTF-8, local) ---------- */
  function cargarArchivo(evento) {
    const archivo = evento.target.files && evento.target.files[0];
    if (!archivo) return;
    if (!/\.txt$/i.test(archivo.name)) {
      mensaje("error", `«${archivo.name}» no es un archivo .txt.`);
      evento.target.value = "";
      return;
    }
    const lector = new FileReader();
    lector.onload = () => {
      const contenido = String(lector.result).replace(/^﻿/, ""); // quita BOM si existe
      el.nombreArchivo.textContent = archivo.name;
      if (contenido.length === 0) {
        mensaje("error", "El archivo está vacío.");
        evento.target.value = "";
        return;
      }
      el.entrada.value = contenido;
      el.lblEntrada.textContent = "Texto plano";
      actualizarContadores();
      mensaje("info", `Archivo «${archivo.name}» cargado (${plural(contar(contenido))}). Presione Cifrar para procesarlo.`);
      evento.target.value = "";
    };
    lector.onerror = () => mensaje("error", `No se pudo leer «${archivo.name}».`);
    lector.readAsText(archivo, "UTF-8");
  }

  /* ---------- Descarga (.txt UTF-8) ---------- */
  function descargar() {
    if (!estado.resultado) { mensaje("error", "Todavía no hay resultado para descargar."); return; }
    const nombre = estado.modo === "descifrar" ? "texto_descifrado.txt" : "texto_cifrado.txt";
    const blob = new Blob([estado.resultado], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    mensaje("ok", `Archivo ${nombre} descargado.`);
  }

  /* ---------- Eventos ---------- */
  el.btnCifrar.addEventListener("click", () => ejecutar("cifrar"));
  el.btnDescifrar.addEventListener("click", () => ejecutar("descifrar"));
  el.btnDescargar.addEventListener("click", descargar);
  el.btnUsar.addEventListener("click", usarResultado);
  el.archivo.addEventListener("change", cargarArchivo);
  el.entrada.addEventListener("input", actualizarContadores);
  el.clave.addEventListener("keydown", e => { if (e.key === "Enter") ejecutar("cifrar"); });

  actualizarContadores();
})();