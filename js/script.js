"use strict";

/* =====================================================================
   Transposición interrumpida — lógica de cifrado + interfaz
   ===================================================================== */

// Alfabeto español usado para ordenar las letras de la clave.
const ALFABETO_ES = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

// Letras acentuadas / con diéresis que se ordenan como su letra base.
const BASE_ORDEN = { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U" };

function aCaracteres(texto) {
  // Array.from separa por punto de código (no por unidad UTF-16).
  return Array.from(texto);
}

/**
 * Normaliza el texto antes de cifrar o descifrar.
 *  - NFC: une "o" + tilde combinante en "ó" (mismo texto, un solo carácter).
 *  - Saltos de línea CRLF → LF (archivos de Windows).
 *  - NUEVO: solo se pasa a mayúsculas si conservarCaso es falso.
 *    Si es verdadero, las minúsculas se respetan tal como se escribieron.
 *  - Si conservarSignos es falso, se dejan solo letras y dígitos
 *    (las letras acentuadas y la Ñ siguen siendo letras y se conservan).
 */
function normalizarTexto(texto, conservarSignos, conservarCaso) {
  let t = texto.normalize("NFC").replace(/\r\n?/g, "\n");
  if (!conservarCaso) t = t.toLocaleUpperCase("es"); // NUEVO: mayúsculas opcionales
  if (!conservarSignos) {
    t = aCaracteres(t).filter(c => /[\p{L}\p{N}]/u.test(c)).join("");
  }
  return t;
}

/**
 * Normaliza la clave y devuelve sus caracteres o un error legible.
 * La clave SIEMPRE se pasa a mayúsculas, así que acepta minúsculas
 * ("convenience" == "CONVENIENCE") sin cambiar el orden de las columnas.
 */
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
   Descifrado (inverso exacto de la misma estructura) — DESACTIVADO
   Se deja comentado porque el HTML actual no tiene botón "Descifrar".
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
    modo: null,          // "cifrar"
    resultado: "",
    detalle: null,       // { numeros, matriz, lecturas, resultado }
    letrasClave: null,
    textoNormalizado: ""
  };

  const $ = id => document.getElementById(id);

  // Solo se referencian elementos que EXISTEN en index.html.
  const el = {
    entrada: $("entrada"), salida: $("salida"), clave: $("clave"), conservar: $("conservar"),
    mayusculas: $("mayusculas"), // NUEVO: casilla de mayúsculas/minúsculas
    archivo: $("archivo"), nombreArchivo: $("nombreArchivo"), status: $("status"),
    cntEntrada: $("cntEntrada"), cntSalida: $("cntSalida"),
    lblEntrada: $("lblEntrada"), lblSalida: $("lblSalida"),
    btnCifrar: $("btnCifrar"), btnDescargar: $("btnDescargar")
  };

  /* ---------- Utilidades de presentación ---------- */
  const contar = t => Array.from(t).length;
  const plural = n => n === 1 ? "1 carácter" : `${n.toLocaleString("es")} caracteres`;

  // Crea un elemento DOM con atributos e hijos.
  function h(tag, attrs, ...hijos) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of hijos) if (c != null) n.append(c);
    return n;
  }

  // Muestra un mensaje de estado (tipo: "ok" | "error" | "info").
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
    // NUEVO: se pasa el estado de la casilla "Conservar mayúsculas y minúsculas"
    const texto = normalizarTexto(el.entrada.value, el.conservar.checked, el.mayusculas.checked);
    if (texto.length === 0) {
      return { error: "Después de quitar espacios y signos no queda ningún carácter. Active \"Conservar espacios y signos\"." };
    }
    return { texto, letras: v.letras, clave: v.clave };
  }

  /* ---------- Acciones ---------- */
  function ejecutar() {
    const v = validarEntradas();
    if (v.error) {
      mensaje("error", v.error);
      if (/clave/i.test(v.error)) el.clave.focus(); else el.entrada.focus();
      return;
    }

    const det = cifrarTransposicionInterrumpida(v.texto, v.letras);

    Object.assign(estado, {
      modo: "cifrar", resultado: det.resultado, detalle: det,
      letrasClave: v.letras, textoNormalizado: v.texto
    });

    el.salida.value = det.resultado;
    el.lblSalida.textContent = "Texto cifrado";
    el.btnDescargar.disabled = false; // habilita la descarga
    actualizarContadores();
    mensaje("ok", `Texto cifrado: ${plural(contar(det.resultado))} transpuestos con la clave ${v.clave}.`);
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
      const contenido = String(lector.result).replace(/^\uFEFF/, ""); // quita BOM si existe
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
      evento.target.value = ""; // permite volver a cargar el mismo archivo
    };
    lector.onerror = () => mensaje("error", `No se pudo leer «${archivo.name}».`);
    lector.readAsText(archivo, "UTF-8");
  }

  /* ---------- Descarga (.txt UTF-8) ---------- */
  function descargar() {
    if (!estado.resultado) { mensaje("error", "Todavía no hay resultado para descargar."); return; }
    const nombre = "texto_cifrado.txt";
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
  el.btnCifrar.addEventListener("click", ejecutar);
  el.btnDescargar.addEventListener("click", descargar);
  el.archivo.addEventListener("change", cargarArchivo);
  el.entrada.addEventListener("input", actualizarContadores);
  el.clave.addEventListener("keydown", e => { if (e.key === "Enter") ejecutar(); });

  actualizarContadores();
})();