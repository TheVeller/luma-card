# Limpiar Event Aggregator y retirar badges

## Objetivo
Dejar el producto enfocado únicamente en agregar, sincronizar, deduplicar, filtrar y exponer eventos y calendarios. Se conservarán las imágenes y logos propios de eventos/calendarios porque ayudan a reconocer las fuentes, pero desaparecerán el generador de badges, su identidad visual y toda su promoción.

Los badges, estilos, plantillas y brand kits ya guardados no se borrarán de la base de datos ni del almacenamiento.

## Cambios

1. **Retirar las superficies de badges**
   - Eliminar Gallery y Templates de la navegación.
   - Retirar sus páginas, el editor de badges, la cámara/foto personal, la composición Canvas, compartir/descargar badges y el chat de diseño con AI.
   - Reemplazar la página actual de cada evento por una ficha sencilla del evento con arte, fecha, ubicación, organizador, descripción y enlace original.
   - Mantener funcionando todos los enlaces existentes desde Events e Import hacia esa ficha.

2. **Eliminar branding de la configuración**
   - Quitar Brand kits, asignaciones de marca por calendario, presets de estilo y análisis visual con AI.
   - Conservar intactos API keys, MCP, sincronización, proveedores, grupos, selección “Mine”, logos de calendarios e imágenes de eventos.
   - Dejar de exponer `brandKitId` y campos equivalentes en las respuestas activas del producto, sin borrar los datos históricos.

3. **Limpiar API, MCP y OAuth**
   - Retirar las herramientas MCP para badges y estilos.
   - Actualizar el manifiesto, permisos, consentimiento e instrucciones para ofrecer solo calendarios y eventos.
   - Mantener los endpoints REST de calendarios, eventos, cambios y salud; actualizar su contrato y documentación para eliminar referencias de branding.

4. **Limpiar identidad y contenido**
   - Reescribir home, acceso, importación, metadatos y descripciones alrededor de “Event Aggregator”.
   - Eliminar el roadmap antiguo de badges y cualquier mención a Badge Studio, Event Router, generación, AI style, plantillas o difusión de badges.
   - Actualizar README y documentación técnica para describir únicamente el agregador multi-provider.

5. **Retirar código sin uso**
   - Eliminar componentes, funciones, motor de layouts, renderizado, tests y endpoints exclusivos de badges/branding.
   - Quitar dependencias que queden sin uso, como QR o paquetes AI, solo después de comprobar que ninguna parte del agregador las necesita.
   - Mantener las tablas, columnas y archivos históricos almacenados; el código nuevo simplemente dejará de consultarlos.

6. **Verificación**
   - Comprobar navegación completa: acceso, Events, detalle de evento, Import, Settings y Admin.
   - Verificar filtros, selección “Mine”, sincronización, API y las herramientas MCP restantes.
   - Ejecutar las pruebas del agregador, revisar errores del navegador y confirmar el resultado en escritorio y móvil.

## Detalles técnicos
- No habrá migración destructiva ni eliminación de datos.
- La ruta `/e/$eventId` se conserva para no romper enlaces, pero pasa a ser una ficha de evento sin herramientas de badge.
- Las estructuras históricas de badges quedarán inactivas y aisladas; podrán recuperarse o eliminarse en una fase posterior.
- El componente visual genérico `Badge` usado para etiquetas de estado no se elimina: no pertenece al generador de badges.
