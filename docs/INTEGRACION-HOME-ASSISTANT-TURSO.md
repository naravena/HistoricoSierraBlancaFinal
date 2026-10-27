# Integración Home Assistant → Turso

## Tabla canónica

La única tabla que deben leer y escribir la web y Home Assistant es `historical_data`.

- `record_type = 'reading'`: lecturas periódicas recibidas desde Home Assistant.
- `record_type = 'statistics'`: estadísticas históricas importadas.
- `readings` y `energy_statistics`: tablas heredadas/deprecadas. Se conservan en Turso como respaldo y no deben recibir nuevas escrituras ni ser consultadas por el portal.

## Automatización de Home Assistant

Sustituye la automatización antigua por esta. Mantiene el envío cada 15 minutos y escribe las lecturas numéricas en `historical_data`. No incluye energía producida en los cálculos del portal; se conservan aquí únicamente por compatibilidad con el listado de entidades.

```yaml
- alias: "Turso - Sincronizar energía Sierra Blanca (15 min)"
  description: "Envía lecturas de Home Assistant a historical_data en Turso."
  mode: single

  triggers:
    - trigger: time_pattern
      minutes: "/15"

  conditions: []

  actions:
    - variables:
        entidades:
          - sensor.sierra_blanca_total_power
          - sensor.sierra_blanca_tension
          - sensor.sierra_blanca_frecuencia
          - sensor.sierra_blanca_potencia_a
          - sensor.sierra_blanca_corriente_a
          - sensor.sierra_blanca_power_factor_a
          - sensor.sierra_blanca_energia_consumida_a
          - sensor.sierra_blanca_energia_producida_a
          - sensor.sierra_blanca_potencia_b
          - sensor.sierra_blanca_corriente_b
          - sensor.sierra_blanca_power_factor_b
          - sensor.sierra_blanca_energia_consumida_b
          - sensor.sierra_blanca_energia_producida_b
          - sensor.sierra_blanca_energia_consumida

    - repeat:
        for_each: "{{ entidades }}"
        sequence:
          - variables:
              entidad: "{{ repeat.item }}"
              valor: "{{ states(repeat.item) }}"
              instante: "{{ now().isoformat() }}"
              # source_row_id debe ser único por record_type. Se deriva del instante
              # y del índice de la entidad para evitar colisiones entre entidades.
              source_id: "{{ (as_timestamp(now()) | int * 1000) + (entidades.index(repeat.item) | int) }}"

          - if:
              - condition: template
                value_template: "{{ is_number(valor) }}"
            then:
              - action: rest_command.turso_insert_readings
                data:
                  payload: >-
                    {% set stmt = {
                      'sql': "INSERT INTO historical_data (record_type, source_row_id, entity_id, recorded_at, value) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM historical_data WHERE record_type = 'reading' AND entity_id = ? AND recorded_at = ?)",
                      'args': [
                        {'type': 'text', 'value': 'reading'},
                        {'type': 'integer', 'value': source_id | int},
                        {'type': 'text', 'value': entidad},
                        {'type': 'text', 'value': instante},
                        {'type': 'float', 'value': valor | float},
                        {'type': 'text', 'value': entidad},
                        {'type': 'text', 'value': instante}
                      ]
                    } %}
                    {{ {'requests': [
                      {'type': 'execute', 'stmt': stmt},
                      {'type': 'close'}
                    ]} | tojson }}
```

### Nota importante sobre `rest_command.turso_insert_readings`

El nombre del servicio puede mantenerse para no romper la automatización, aunque ahora escriba en `historical_data`. Conserva su URL de Turso y sus cabeceras actuales; cambia únicamente el SQL/payload de la automatización. No pegues tokens en este archivo ni en GitHub.

La columna `source_row_id` es obligatoria y tiene una restricción única junto con `record_type`; por eso el INSERT la incluye. El `WHERE NOT EXISTS` evita reinsertar la misma entidad con el mismo timestamp si se repite una ejecución.

## Comprobación después de guardar

En Turso ejecuta:

```sql
SELECT record_type, entity_id, recorded_at, value, source_row_id
FROM historical_data
WHERE record_type = 'reading'
ORDER BY recorded_at DESC
LIMIT 30;
```

Comprueba que aparecen filas nuevas cada 15 minutos para los sensores numéricos. Para confirmar que la tabla antigua ya no recibe nuevas escrituras, compara su recuento antes y después de una ejecución; no la borres ni la vacíes.

El portal ya consulta `historical_data` en `src/queries.js`. No hace falta cambiar esa consulta para corregir el destino de escritura de Home Assistant.
